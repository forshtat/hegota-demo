import { shortAddr } from "../format.js";

interface TokenInfo {
  symbol: string;
  decimals: number;
}

const KNOWN_TOKENS: Record<string, TokenInfo> = {};

export function registerToken(address: string, info: TokenInfo): void {
  if (address) KNOWN_TOKENS[address.toLowerCase()] = info;
}

export function formatTokenAmount(address: string, amountWei: bigint): string {
  const info = KNOWN_TOKENS[address.toLowerCase()];
  if (!info) return `${amountWei} (${shortAddr(address)})`;
  return `${amountWei / 10n ** BigInt(info.decimals)} ${info.symbol}`;
}
