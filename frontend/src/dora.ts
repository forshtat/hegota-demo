export const DORA_BASE = "https://dora.hegota.ethrex.xyz";

export function doraTxUrl(txHash: string): string {
  return `${DORA_BASE}/tx/${txHash}`;
}

export function doraAddressUrl(address: string): string {
  return `${DORA_BASE}/address/${address}`;
}
