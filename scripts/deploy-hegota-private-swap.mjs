#!/usr/bin/env node
// Deploys the MockSwapETH + PrivateSwapExecutor + PrivateSwapAssertion trio and a fresh
// MockERC20 output token to Hegotá, seeds MockSwapETH with liquidity, and merges
// VITE_HEGOTA_PRIVATE_SWAP_* into frontend/.env.
//
// Usage: node scripts/deploy-hegota-private-swap.mjs  (from project root, with
// HEGOTA_PRIVATE_KEY set in .env, and VITE_HEGOTA_POOL already in frontend/.env from
// scripts/deploy-hegota-shielded-pool.mjs).

import "dotenv/config";
import { JsonRpcProvider, Wallet, ContractFactory, Contract, parseEther } from "ethers";
import { existsSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FRONTEND = path.join(ROOT, "frontend");

const ARTIFACT = (rel) => path.join(ROOT, "artifacts/contracts", rel);
const MOCK_ERC20 = ARTIFACT("shared/MockERC20.sol/MockERC20.json");
const MOCK_SWAP_ETH = ARTIFACT("hegota/MockSwapETH.sol/MockSwapETH.json");
const PRIVATE_SWAP_EXECUTOR = ARTIFACT("hegota/PrivateSwapExecutor.sol/PrivateSwapExecutor.json");
const PRIVATE_SWAP_ASSERTION = ARTIFACT("hegota/PrivateSwapAssertion.sol/PrivateSwapAssertion.json");

const BLOCK_START = "# --- Hegotá private swap (scripts/deploy-hegota-private-swap.mjs, Stage 2) ---";
const BLOCK_END = "# --- end Hegotá private swap ---";

function die(msg) {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}

function artifact(fullPath) {
  if (!existsSync(fullPath)) die(`Artifact not found: ${fullPath}\n  Run \`npx hardhat build\` first.`);
  return JSON.parse(readFileSync(fullPath, "utf8"));
}

function loadEnv(path_) {
  const env = {};
  if (!existsSync(path_)) return env;
  for (const line of readFileSync(path_, "utf8").split("\n")) {
    const m = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

async function deploy(signer, { abi, bytecode }, args, label, fees) {
  process.stdout.write(`  ${label}... `);
  const factory = new ContractFactory(abi, bytecode, signer);
  const contract = await factory.deploy(...args, fees);
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(addr);
  return addr;
}

async function send(signer, addr, abi, method, args, label, fees) {
  process.stdout.write(`  ${label}... `);
  const c = new Contract(addr, abi, signer);
  const tx = await c[method](...args, fees);
  const receipt = await tx.wait();
  if (receipt.status !== 1) die(`${label} reverted (tx ${tx.hash})`);
  console.log(`ok (tx ${tx.hash})`);
}

async function main() {
  const rpcUrl = process.env.HEGOTA_RPC_URL ?? "https://rpc1.hegota.ethrex.xyz";
  const privateKey = process.env.HEGOTA_PRIVATE_KEY;
  if (!privateKey) die("HEGOTA_PRIVATE_KEY is not set. See .env.example.");

  const feEnv = loadEnv(path.join(FRONTEND, ".env"));
  const pool = feEnv.VITE_HEGOTA_POOL;
  if (!pool) die("VITE_HEGOTA_POOL not set in frontend/.env -- run deploy-hegota-shielded-pool.mjs first.");

  console.log(`\nConnecting to ${rpcUrl}...`);
  const provider = new JsonRpcProvider(rpcUrl);
  try { await provider.getBlockNumber(); }
  catch { die(`Cannot reach Hegotá RPC at ${rpcUrl}.`); }

  const signer = new Wallet(privateKey, provider);
  const deployer = signer.address;
  const bal = await provider.getBalance(deployer);
  console.log(`Deployer: ${deployer}  balance=${(Number(bal) / 1e18).toFixed(6)} ETH`);
  if (bal === 0n) die(`Deployer has no funds. Fund ${deployer}.`);

  const latestBlock = await provider.getBlock("latest");
  const baseFee = latestBlock.baseFeePerGas ?? 0n;
  const maxPriorityFeePerGas = 1_000n;
  const fees = { maxPriorityFeePerGas, maxFeePerGas: baseFee * 4n + maxPriorityFeePerGas };
  console.log(`Fees: baseFee=${baseFee} maxFeePerGas=${fees.maxFeePerGas} maxPriorityFeePerGas=${fees.maxPriorityFeePerGas}`);

  console.log(`\nDeploying private-swap contracts (pool=${pool}):`);

  const SUPPLY = parseEther("1000000");
  const LIQUIDITY = parseEther("500000");
  // 1 ETH -> 1000 BONUS: an arbitrary, demo-legible rate (RATE_DENOMINATOR = 1e18).
  const RATE_NUMERATOR = 1000n * 10n ** 18n;

  const MockERC20 = artifact(MOCK_ERC20);
  const outToken = await deploy(signer, MockERC20, ["Bonus Token", "BONUS", deployer, SUPPLY], "MockERC20 (BONUS)", fees);

  const MockSwapETH = artifact(MOCK_SWAP_ETH);
  const swap = await deploy(signer, MockSwapETH, [outToken, RATE_NUMERATOR], "MockSwapETH", fees);

  await send(signer, outToken, MockERC20.abi, "transfer", [swap, LIQUIDITY], "seed MockSwapETH liquidity", fees);

  const PrivateSwapExecutor = artifact(PRIVATE_SWAP_EXECUTOR);
  const executor = await deploy(signer, PrivateSwapExecutor, [pool, swap], "PrivateSwapExecutor", fees);

  const PrivateSwapAssertion = artifact(PRIVATE_SWAP_ASSERTION);
  const assertion = await deploy(signer, PrivateSwapAssertion, [], "PrivateSwapAssertion", fees);

  // ── Merge VITE_HEGOTA_PRIVATE_SWAP_* keys into frontend/.env, preserving everything else ──

  const block = [
    BLOCK_START,
    `VITE_HEGOTA_PRIVATE_SWAP_OUT_TOKEN=${outToken}`,
    `VITE_HEGOTA_PRIVATE_SWAP_MOCK_SWAP=${swap}`,
    `VITE_HEGOTA_PRIVATE_SWAP_EXECUTOR=${executor}`,
    `VITE_HEGOTA_PRIVATE_SWAP_ASSERTION=${assertion}`,
    BLOCK_END,
  ].join("\n");

  const envPath = path.join(FRONTEND, ".env");
  let existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const blockRe = new RegExp(
    `${BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`,
  );
  existing = existing.replace(blockRe, "");
  const merged = existing.replace(/\n*$/, "\n\n") + block + "\n";

  console.log(`\nWriting Hegotá private-swap section to ${envPath}`);
  writeFileSync(envPath, merged);

  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
