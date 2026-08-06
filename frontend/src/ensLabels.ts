// Stub for ENS reverse-resolution, keyed by real address. The wallet-simulator drawer's
// narrative depends on showing trusted-looking names (e.g. "vitalik.eth") for some addresses --
// that's a deliberate, load-bearing part of the demo, not decoration to strip out. The name
// must be looked up FROM the real address a scenario actually uses, not hand-typed as an
// independent string next to it, to avoid the two drifting apart.
//
// registerEnsName is called once per scenario at module load, right next to the constant that
// holds the real address; resolveEnsName is a synchronous, address-keyed lookup so a real
// on-chain reverse-resolve (an ensRegistry.resolver(address).name(address) call) could replace
// this implementation later without any call site changing.

const KNOWN_ENS_NAMES: Record<string, string> = {};

export function registerEnsName(address: string, name: string): void {
  if (address) KNOWN_ENS_NAMES[address.toLowerCase()] = name;
}

export function resolveEnsName(address: string): string | null {
  return KNOWN_ENS_NAMES[address.toLowerCase()] ?? null;
}
