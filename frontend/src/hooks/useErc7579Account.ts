import { useCallback, useEffect, useState } from "react";
import { useWallet } from "../contexts/WalletContext.js";
import {
  isErc7579Configured,
  predictAccountAddress,
  isAccountDeployed,
  provisionAccount,
} from "../erc7579Account.js";
import { isAccountFunded, fundAndApproveForSwap } from "../hegotaAccountFunding.js";
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
    setIsProvisioning(true);
    setProvisionError(null);
    try {
      const { address: deployed, txHash } = await provisionAccount(provider, signer, address, isDevAutoWallet);
      setAccountAddress(deployed);
      setIsDeployed(true);
      setProvisionTxHash(txHash);
    } catch (e) {
      setProvisionError(formatWalletError(e));
    } finally {
      setIsProvisioning(false);
    }
  }, [provider, signer, address, isDevAutoWallet]);

  const fund = useCallback(async () => {
    if (!provider || !signer || !address || !accountAddress || chainId === undefined) return;
    setIsFunding(true);
    setFundError(null);
    try {
      const result = await fundAndApproveForSwap(provider, signer, chainId, accountAddress, isDevAutoWallet);
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
  }, [provider, signer, address, accountAddress, chainId, isDevAutoWallet]);

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
