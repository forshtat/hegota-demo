import { ethers } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

// ─── Signers ──────────────────────────────────────────────────────────────────

export async function getSigners(): Promise<{
  deployer: HardhatEthersSigner;
  user: HardhatEthersSigner;
}> {
  const [deployer, user] = await ethers.getSigners();
  return { deployer, user };
}

// ─── TestSubject helper ───────────────────────────────────────────────────────

export async function deployTestSubject() {
  const factory = await ethers.getContractFactory("TestSubject");
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  return contract;
}

// ─── keccak256("Transfer(address,uint256)") ──────────────────────────────────
// Matches the Transfer event in TestSubject.sol
export const TRANSFER_TOPIC =
  "0x69ca02dd4edd7bf0a4abb9ed3b7af3f14778db5d61921c7dc7cd545266326de2";

export async function fundAddress(
  from: HardhatEthersSigner,
  to: string,
  amountEth: string,
) {
  const tx = await from.sendTransaction({
    to,
    value: ethers.parseEther(amountEth),
  });
  await tx.wait();
}
