import { ContractFactory, type ContractRunner, type InterfaceAbi } from "ethers";
import { registerAddress } from "./addressRegistry.js";
import sources from "./contractSources.js";

export async function deployContract(
  signer: ContractRunner,
  abi: InterfaceAbi,
  bytecode: string,
  args: unknown[] = [],
  name?: string,
): Promise<string> {
  const factory = new ContractFactory(abi, bytecode, signer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  if (name) {
    registerAddress(address, { name, source: sources[name] });
  }
  return address;
}
