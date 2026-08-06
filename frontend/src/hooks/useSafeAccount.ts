// Mirrors useErc7579Account.ts's shape (minus the fund/approve half, which the Safe scenario
// doesn't need at setup time) so AccountSetup.tsx can drive this step the same way.

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "../contexts/WalletContext.js";
import {
  isSafeConfigured,
  predictSafeAddress,
  isSafeDeployed,
  provisionSafe,
} from "../hegotaSafeAccount.js";
import { formatWalletError } from "../errorFormat.js";

export interface UseSafeAccountResult {
  configured: boolean;
  safeAddress: string | null;
  isDeployed: boolean;
  isChecking: boolean;
  isProvisioning: boolean;
  provisionError: string | null;
  provisionTxHash: string | null;
  provision(): Promise<void>;
  // Re-runs the on-chain deployed check on demand: WalletSimulatorDrawer mounts this hook once
  // for the app's whole lifetime, so its own copy of isDeployed otherwise never learns that
  // AccountSetup.tsx's separate hook instance just provisioned the Safe.
  refresh(): Promise<void>;
}

export function useSafeAccount(): UseSafeAccountResult {
  const { isConnected, isHegota, provider, signer, address } = useWallet();

  const [safeAddress, setSafeAddress] = useState<string | null>(null);
  const [isDeployed, setIsDeployed] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [provisionTxHash, setProvisionTxHash] = useState<string | null>(null);

  const configured = isSafeConfigured();
  const ready = isConnected && isHegota && configured && !!provider && !!address;

  const refresh = useCallback(async () => {
    if (!ready || !provider || !address) {
      setSafeAddress(null);
      setIsDeployed(false);
      return;
    }
    setIsChecking(true);
    const predicted = await predictSafeAddress(provider, address);
    setSafeAddress(predicted);
    const deployed = await isSafeDeployed(provider, predicted);
    setIsDeployed(deployed);
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
      const { address: deployed, txHash } = await provisionSafe(provider, signer, address);
      setSafeAddress(deployed);
      setIsDeployed(true);
      setProvisionTxHash(txHash);
    } catch (e) {
      setProvisionError(formatWalletError(e));
    } finally {
      setIsProvisioning(false);
    }
  }, [provider, signer, address]);

  return {
    configured,
    safeAddress,
    isDeployed,
    isChecking,
    isProvisioning,
    provisionError,
    provisionTxHash,
    provision,
    refresh,
  };
}
