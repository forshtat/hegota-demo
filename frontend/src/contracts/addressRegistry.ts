export interface ContractInfo {
  name: string;
  source?: string;
  description?: string;
}

const registry     = new Map<string, ContractInfo>();
const namedRegistry = new Map<string, ContractInfo>();

export function registerAddress(address: string, info: ContractInfo): void {
  registry.set(address.toLowerCase(), info);
}

export function registerByName(name: string, info: ContractInfo): void {
  namedRegistry.set(name, info);
}

export function lookupAddress(addressOrName: string): ContractInfo | undefined {
  return registry.get(addressOrName.toLowerCase()) ?? namedRegistry.get(addressOrName);
}
