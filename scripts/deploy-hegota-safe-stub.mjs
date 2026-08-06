#!/usr/bin/env node
// Deploys the TEMPORARY MinimalSafeStub singleton (contracts/hegota/MinimalSafeStub.sol)
// plus the REAL, unmodified @safe-global/safe-contracts SafeProxyFactory to Hegotá, and merges
// VITE_HEGOTA_SAFE_SINGLETON / VITE_HEGOTA_SAFE_PROXY_FACTORY into frontend/.env -- the exact
// two env vars frontend/src/hegotaSafeAccount.ts already reads. That file needs ZERO code
// changes: it already computes the SafeProxy CREATE2 address and builds the real Safe's
// setup(...) calldata generically from whatever address VITE_HEGOTA_SAFE_SINGLETON points at,
// and MinimalSafeStub.setup(...) matches the real Safe's setup() signature exactly.
//
// This is a scoped one-off script -- it does NOT touch deploy-hegota.mjs's main flow.
// Usage: node scripts/deploy-hegota-safe-stub.mjs  (from project root, with HEGOTA_PRIVATE_KEY set in .env)

import "dotenv/config";
import { JsonRpcProvider, Wallet, ContractFactory } from "ethers";
import { existsSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const FRONTEND  = path.join(ROOT, "frontend");

const SAFE_PROXY_FACTORY_ARTIFACT = path.join(
  ROOT, "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json",
);
const MINIMAL_SAFE_STUB_ARTIFACT = path.join(
  ROOT, "artifacts/contracts/hegota/MinimalSafeStub.sol/MinimalSafeStub.json",
);

const BLOCK_START = "# --- Hegotá Safe stub (scripts/deploy-hegota-safe-stub.mjs, Task 10b) ---";
const BLOCK_END   = "# --- end Hegotá Safe stub ---";

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

  const MinimalSafeStub = artifact(MINIMAL_SAFE_STUB_ARTIFACT);
  const SafeProxyFactory = artifact(SAFE_PROXY_FACTORY_ARTIFACT);

  console.log("\nDeploying Hegotá Safe stub infrastructure (temporary, see contracts/hegota/MinimalSafeStub.sol):");
  const singleton   = await deploy(signer, MinimalSafeStub, [], "MinimalSafeStub (singleton)", n(), fees);
  const proxyFactory = await deploy(signer, SafeProxyFactory, [], "SafeProxyFactory (real, unmodified)", n(), fees);

  // ── Merge VITE_HEGOTA_SAFE_* keys into frontend/.env, preserving everything else ──

  const block = [
    BLOCK_START,
    `VITE_HEGOTA_SAFE_SINGLETON=${singleton}`,
    `VITE_HEGOTA_SAFE_PROXY_FACTORY=${proxyFactory}`,
    BLOCK_END,
  ].join("\n");

  const envPath = path.join(FRONTEND, ".env");
  let existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const blockRe = new RegExp(
    `${BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`,
  );
  existing = existing.replace(blockRe, "");

  const merged = existing.replace(/\n*$/, "\n\n") + block + "\n";

  console.log(`\nWriting Hegotá Safe stub section to ${envPath}`);
  writeFileSync(envPath, merged);

  console.log("\nDone. Set up a personal Safe from /account-setup (Step 3) once the frontend is running.\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
