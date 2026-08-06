#!/usr/bin/env node
// Deploys MaliciousSafeDelegate + SafeControlPlaneAssertion + BenignSafeDelegate
// (contracts/hegota/MaliciousSafeDelegate.sol, contracts/hegota/SafeControlPlaneAssertion.sol,
// contracts/hegota/BenignSafeDelegate.sol) to Hegotá, and merges
// VITE_HEGOTA_MALICIOUS_SAFE_DELEGATE / VITE_HEGOTA_SAFE_CONTROL_PLANE_ASSERTION /
// VITE_HEGOTA_BENIGN_SAFE_DELEGATE into frontend/.env -- the pieces
// hegotaScenarios/controlPlaneTakeoverScenario.ts wires up (BenignSafeDelegate.sol's own doc
// comment explains why it must be genuinely storage-free).
//
// This is a scoped one-off script -- it does NOT touch deploy-hegota.mjs's main flow, mirroring
// scripts/deploy-hegota-safe-stub.mjs's discipline.
//
// Usage: node scripts/deploy-hegota-control-plane.mjs  (from project root, with HEGOTA_PRIVATE_KEY set in .env)

import "dotenv/config";
import { JsonRpcProvider, Wallet, ContractFactory } from "ethers";
import { existsSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const FRONTEND  = path.join(ROOT, "frontend");

const MALICIOUS_SAFE_DELEGATE_ARTIFACT = path.join(
  ROOT, "artifacts/contracts/hegota/MaliciousSafeDelegate.sol/MaliciousSafeDelegate.json",
);
const SAFE_CONTROL_PLANE_ASSERTION_ARTIFACT = path.join(
  ROOT, "artifacts/contracts/hegota/SafeControlPlaneAssertion.sol/SafeControlPlaneAssertion.json",
);
const BENIGN_SAFE_DELEGATE_ARTIFACT = path.join(
  ROOT, "artifacts/contracts/hegota/BenignSafeDelegate.sol/BenignSafeDelegate.json",
);

const BLOCK_START = "# --- Hegotá Control-Plane Takeover (scripts/deploy-hegota-control-plane.mjs, Task 11) ---";
const BLOCK_END   = "# --- end Hegotá Control-Plane Takeover ---";

function die(msg) {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}

function artifact(fullPath) {
  if (!existsSync(fullPath)) die(`Artifact not found: ${fullPath}\n  Run \`npx hardhat build\` first.`);
  return JSON.parse(readFileSync(fullPath, "utf8"));
}

async function deploy(signer, { abi, bytecode }, args, label, nonce, fees) {
  process.stdout.write(`  ${label}... `);
  const factory  = new ContractFactory(abi, bytecode, signer);
  const contract = await factory.deploy(...args, { nonce, ...fees });
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(addr);
  return addr;
}

async function main() {
  const rpcUrl     = process.env.HEGOTA_RPC_URL ?? "https://rpc1.hegota.ethrex.xyz";
  const privateKey = process.env.HEGOTA_PRIVATE_KEY;

  if (!privateKey) {
    die(
      "HEGOTA_PRIVATE_KEY is not set.\n" +
      "  Fund an EOA via https://faucet.hegota.ethrex.xyz, then set HEGOTA_PRIVATE_KEY in .env.",
    );
  }

  console.log(`\nConnecting to ${rpcUrl}...`);
  const provider = new JsonRpcProvider(rpcUrl);
  try { await provider.getBlockNumber(); }
  catch { die(`Cannot reach Hegotá RPC at ${rpcUrl}.`); }

  const signer = new Wallet(privateKey, provider);
  const deployer = signer.address;
  let nonce = await provider.getTransactionCount(deployer, "pending");
  function n() { return nonce++; }

  const bal = await provider.getBalance(deployer);
  console.log(`Deployer: ${deployer}  balance=${(Number(bal) / 1e18).toFixed(4)} ETH`);
  if (bal === 0n) {
    die(`Deployer has no funds. Claim from https://faucet.hegota.ethrex.xyz for address ${deployer}.`);
  }

  // See hegotaWallet.ts's lowFeeOverrides comment: Hegotá's fee-suggestion RPCs return a
  // flat ~1 gwei unrelated to the real live base fee; ethers' automatic fee estimation
  // trusts that suggestion, which can overpay by ~6 orders of magnitude.
  const latestBlock = await provider.getBlock("latest");
  const baseFee = latestBlock.baseFeePerGas ?? 0n;
  const maxPriorityFeePerGas = 1_000n;
  const fees = { maxPriorityFeePerGas, maxFeePerGas: baseFee * 4n + maxPriorityFeePerGas };
  console.log(`Fees: baseFee=${baseFee} maxFeePerGas=${fees.maxFeePerGas} maxPriorityFeePerGas=${fees.maxPriorityFeePerGas}`);

  const MaliciousSafeDelegate = artifact(MALICIOUS_SAFE_DELEGATE_ARTIFACT);
  const SafeControlPlaneAssertion = artifact(SAFE_CONTROL_PLANE_ASSERTION_ARTIFACT);
  const BenignSafeDelegate = artifact(BENIGN_SAFE_DELEGATE_ARTIFACT);

  console.log("\nDeploying Control-Plane Takeover demo contracts:");
  const maliciousSafeDelegate = await deploy(signer, MaliciousSafeDelegate, [], "MaliciousSafeDelegate", n(), fees);
  const safeControlPlaneAssertion = await deploy(signer, SafeControlPlaneAssertion, [], "SafeControlPlaneAssertion", n(), fees);
  const benignSafeDelegate = await deploy(signer, BenignSafeDelegate, [], "BenignSafeDelegate", n(), fees);

  // ── Merge VITE_HEGOTA_* keys into frontend/.env, preserving everything else ──

  const block = [
    BLOCK_START,
    `VITE_HEGOTA_MALICIOUS_SAFE_DELEGATE=${maliciousSafeDelegate}`,
    `VITE_HEGOTA_SAFE_CONTROL_PLANE_ASSERTION=${safeControlPlaneAssertion}`,
    `VITE_HEGOTA_BENIGN_SAFE_DELEGATE=${benignSafeDelegate}`,
    BLOCK_END,
  ].join("\n");

  const envPath = path.join(FRONTEND, ".env");
  let existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const blockRe = new RegExp(
    `${BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`,
  );
  existing = existing.replace(blockRe, "");

  const merged = existing.replace(/\n*$/, "\n\n") + block + "\n";

  console.log(`\nWriting Control-Plane Takeover section to ${envPath}`);
  writeFileSync(envPath, merged);

  console.log("\nDone.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
