const CHAIN_ID = parseInt(import.meta.env.VITE_CHAIN_ID ?? "1337");

function isLocalNetwork(): boolean {
  return CHAIN_ID === 1337;
}

export function txUrl(hash: string): string {
  if (isLocalNetwork()) return `/tx/${hash}`;
  const base = (import.meta.env.VITE_EXPLORER_URL ?? "https://etherscan.io").replace(/\/$/, "");
  return `${base}/tx/${hash}`;
}
