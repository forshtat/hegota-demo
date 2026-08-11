// Split out of hegotaAccountFunding.ts so erc7579Account.ts (which needs this for self-funded
// account provisioning) and hegotaAccountFunding.ts (which imports from erc7579Account.ts) don't
// form a circular import.

import type { BrowserProvider } from "ethers";

const FAUCET_CLAIM_URL = "https://faucet.hegota.ethrex.xyz/api/claim";

/** Claims Hegotá testnet ETH for `toAddress` from the official public faucet -- used by the
 *  sidebar's Faucet button and by self-funded account/Safe provisioning. The faucet controls
 *  the amount (currently 1 ETH per claim) and rate-limits by IP itself; this is a same-origin-
 *  only endpoint (it 403s any request carrying a browser Origin header from a different
 *  origin), so this only works once that restriction is lifted or relaxed for this app's
 *  origin. No client-held key is involved -- the faucet's own operator key pays and signs the
 *  transfer server-side. */
export async function claimHegotaFaucet(toAddress: string): Promise<void> {
  const res = await fetch(FAUCET_CLAIM_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: toAddress }),
  });
  const body = await res.json().catch(() => ({}) as { msg?: unknown });
  if (!res.ok) {
    throw new Error(typeof body.msg === "string" ? body.msg : `Faucet claim failed (${res.status})`);
  }
}

/** Polls `address`'s balance until non-zero, or throws once the window elapses -- a faucet
 *  claim's transfer needs ~1 slot (6s, per Hegotá's own docs) to actually land on chain. */
export async function waitForNonZeroBalance(
  provider: BrowserProvider,
  address: string,
  attempts = 10,
  intervalMs = 2000,
): Promise<bigint> {
  for (let i = 0; i < attempts; i++) {
    const balance = await provider.getBalance(address);
    if (balance > 0n) return balance;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`No balance detected at ${address} after claiming from the faucet`);
}
