import { useCallback, useEffect, useState } from "react";
import { useWallet } from "../contexts/WalletContext.js";
import { useHegotaWalletPanel } from "../contexts/HegotaWalletPanelContext.js";
import {
  isErc7579Configured,
  predictAccountAddress,
  isAccountDeployed,
  provisionAccount,
  prepareProvisionAccount,
} from "../erc7579Account.js";
import { isAccountFunded, fundAndApproveForSwap, prepareFundAndApproveForSwap } from "../hegotaAccountFunding.js";
import { formatWalletError } from "../errorFormat.js";

export interface UseErc7579AccountResult {
  configured: boolean;
  accountAddress: string | null;
  isDeployed: boolean;
  isChecking: boolean;
  isProvisioning: boolean;
  provisionError: string | null;
  provisionTxHash: string | null;
  provision(): Promise<void>;
  isFunded: boolean;
  isFunding: boolean;
  fundError: string | null;
  fundTxHash: string | null;
  approveTxHash: string | null;
  fund(): Promise<void>;
  // Re-runs the on-chain deployed/funded check on demand: WalletSimulatorDrawer mounts this
  // hook once for the app's whole lifetime, so its own copy of isDeployed/isFunded otherwise
  // never learns that AccountSetup.tsx's separate hook instance just provisioned/funded it.
  refresh(): Promise<void>;
}

export function useErc7579Account(): UseErc7579AccountResult {
  const { isConnected, isHegota, provider, signer, address, chainId, isDevAutoWallet } = useWallet();
  const { armProvisioning } = useHegotaWalletPanel();

  const [accountAddress, setAccountAddress] = useState<string | null>(null);
  const [isDeployed, setIsDeployed] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [provisionTxHash, setProvisionTxHash] = useState<string | null>(null);
  const [isFunded, setIsFunded] = useState(false);
  const [isFunding, setIsFunding] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  const [fundTxHash, setFundTxHash] = useState<string | null>(null);
  const [approveTxHash, setApproveTxHash] = useState<string | null>(null);

  const configured = isErc7579Configured();
  const ready = isConnected && isHegota && configured && !!provider && !!address;

  const refresh = useCallback(async () => {
    if (!ready || !provider || !address) {
      setAccountAddress(null);
      setIsDeployed(false);
      setIsFunded(false);
      return;
    }
    setIsChecking(true);
    const predicted = await predictAccountAddress(provider, address);
    setAccountAddress(predicted);
    const deployed = await isAccountDeployed(provider, predicted);
    setIsDeployed(deployed);
    const funded = deployed ? await isAccountFunded(provider, predicted) : false;
    setIsFunded(funded);
    setIsChecking(false);
  }, [ready, provider, address]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, provider, address]);

  const provision = useCallback(async () => {
    if (!provider || !signer || !address) return;
    setProvisionError(null);

    if (isDevAutoWallet) {
      // Arms the wallet-simulator drawer instead of awaiting inline -- ProvisioningPanel.tsx
      // does the actual submitFrameTx call once the user reviews and approves the deploy
      // transaction there. isProvisioning stays true until that resolves (either outcome),
      // matching the relay path's own busy indicator.
      setIsProvisioning(true);
      armProvisioning({
        title: "Deploy ERC-7579 account",
        prepare: (reportProgress) => prepareProvisionAccount(provider, address, reportProgress),
        onResult: (result) => {
          setIsProvisioning(false);
          if (result.outcome === "success") {
            setProvisionTxHash(result.txHash);
            void refresh();
          } else {
            setProvisionError(`Deployment ${result.outcome} (tx ${result.txHash})`);
          }
        },
        onPrepareError: (e) => {
          setIsProvisioning(false);
          setProvisionError(formatWalletError(e));
        },
      });
      return;
    }

    setIsProvisioning(true);
    try {
      const { address: deployed, txHash } = await provisionAccount(provider, signer, address);
      setAccountAddress(deployed);
      setIsDeployed(true);
      setProvisionTxHash(txHash);
    } catch (e) {
      setProvisionError(formatWalletError(e));
    } finally {
      setIsProvisioning(false);
    }
  }, [provider, signer, address, isDevAutoWallet, armProvisioning, refresh]);

  const fund = useCallback(async () => {
    if (!provider || !signer || !address || !accountAddress || chainId === undefined) return;
    setFundError(null);

    if (isDevAutoWallet) {
      setIsFunding(true);
      armProvisioning({
        title: "Fund & approve",
        prepare: (reportProgress) =>
          prepareFundAndApproveForSwap(provider, signer, chainId, accountAddress, reportProgress),
        onResult: (result) => {
          setIsFunding(false);
          if (result.outcome === "success") {
            setFundTxHash(result.txHash);
            setApproveTxHash(result.txHash);
            void refresh();
          } else {
            setFundError(`Fund+approve ${result.outcome} (tx ${result.txHash})`);
          }
        },
        onPrepareError: (e) => {
          setIsFunding(false);
          setFundError(formatWalletError(e));
        },
      });
      return;
    }

    setIsFunding(true);
    try {
      const result = await fundAndApproveForSwap(provider, signer, chainId, accountAddress);
      setIsFunded(true);
      if (result) {
        setFundTxHash(result.fundTxHash);
        setApproveTxHash(result.approveTxHash);
      }
    } catch (e) {
      setFundError(formatWalletError(e));
    } finally {
      setIsFunding(false);
    }
  }, [provider, signer, address, accountAddress, chainId, isDevAutoWallet, armProvisioning, refresh]);

  return {
    configured,
    accountAddress,
    isDeployed,
    isChecking,
    isProvisioning,
    provisionError,
    provisionTxHash,
    provision,
    isFunded,
    isFunding,
    fundError,
    fundTxHash,
    approveTxHash,
    fund,
    refresh,
  };
}
