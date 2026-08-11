import { useEffect, useState } from "react";
import type { BrowserProvider } from "ethers";

/** One-shot (not polling) balance read -- advisory display only (used by AccountSetup.tsx,
 *  gated on the Demo Wallet like PrivateSwapAccountPicker.tsx, and Sidebar.tsx, always
 *  enabled). `enabled` lets a caller skip the RPC call entirely when the value won't be shown. */
export function useAdvisoryBalance(
  provider: BrowserProvider | null,
  enabled: boolean,
  target: string | null,
): bigint | null {
  const [balance, setBalance] = useState<bigint | null>(null);
  useEffect(() => {
    if (!provider || !enabled || !target) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    provider.getBalance(target).then((b) => {
      if (!cancelled) setBalance(b);
    });
    return () => {
      cancelled = true;
    };
  }, [provider, enabled, target]);
  return balance;
}
