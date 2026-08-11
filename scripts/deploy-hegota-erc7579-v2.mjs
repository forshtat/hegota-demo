#!/usr/bin/env node
// Redeploys exactly the Hegotá ERC-7579 contracts that changed for the Demo Wallet
// self-funded provisioning feature, and updates their addresses in frontend/.env IN PLACE
// (targeted line replacement, not deploy-hegota.mjs's whole-block append) -- deliberately
// NOT a full deploy-hegota.mjs re-run, which would also redeploy TestSubject/
// RequiredEventAssertion/OwnerEcdsaValidator/PostTxExecutor and break every
// already-provisioned account's address.
//
// MinimalERC7579Account is now a shared IMPLEMENTATION (deployed once, delegatecalled by
// every owner's own tiny MinimalERC7579AccountProxy) rather than one instance per owner --
// see that contract's own doc comment for why: EIP-8141's MAX_VERIFY_GAS budget for a
// self-funded `deploy+self_verify` account deployment (the account paying for its own
// CREATE2) only ever affords a proxy-sized deploy, never the implementation's full runtime.
// OwnerEcdsaValidator/PostTxExecutor don't need to change (referenced only by address, not
// embedded in anything) and are reused as-is from the existing frontend/.env.
//
// (An earlier version of this script also redeployed InToken/OutToken/MockSwap for
// MockERC20's new mint() -- that redeploy already landed in a prior run and doesn't need
// repeating here.)
//
// Usage: node scripts/deploy-hegota-erc7579-v2.mjs  (from project root, with
// HEGOTA_PRIVATE_KEY set in .env, and VITE_HEGOTA_OWNER_VALIDATOR/VITE_HEGOTA_POST_TX_EXECUTOR
// already present in frontend/.env from a prior deploy-hegota.mjs run)

import "dotenv/config";
import { JsonRpcProvider, Wallet, ContractFactory } from "ethers";
import { existsSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const FRONTEND  = path.join(ROOT, "frontend");
const ARTIFACTS = path.join(ROOT, "artifacts/contracts");

function die(msg) {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}

function artifact(relPath) {
  const full = path.join(ARTIFACTS, relPath);
  if (!existsSync(full)) die(`Artifact not found: ${relPath}\n  Run \`npx hardhat build\` first.`);
  return JSON.parse(readFileSync(full, "utf8"));
}

function readFrontendEnvVar(key) {
  const envPath = path.join(FRONTEND, ".env");
  const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const m = existing.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
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

function setEnvVar(envText, key, value) {
  const re = new RegExp(`^${key}=.*$`, "m");
  const line = `${key}=${value}`;
  return re.test(envText) ? envText.replace(re, line) : envText.replace(/\n*$/, "\n") + line + "\n";
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

  const ownerValidator = readFrontendEnvVar("VITE_HEGOTA_OWNER_VALIDATOR");
  const postTxExecutor = readFrontendEnvVar("VITE_HEGOTA_POST_TX_EXECUTOR");
  if (!ownerValidator || !postTxExecutor) {
    die("VITE_HEGOTA_OWNER_VALIDATOR / VITE_HEGOTA_POST_TX_EXECUTOR missing from frontend/.env -- run deploy-hegota.mjs first.");
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

  const latestBlock = await provider.getBlock("latest");
  const baseFee = latestBlock.baseFeePerGas ?? 0n;
  const maxPriorityFeePerGas = 1_000n;
  const fees = { maxPriorityFeePerGas, maxFeePerGas: baseFee * 4n + maxPriorityFeePerGas };
  console.log(`Fees: baseFee=${baseFee} maxFeePerGas=${fees.maxFeePerGas} maxPriorityFeePerGas=${fees.maxPriorityFeePerGas}`);

  const MinimalERC7579Account = artifact("erc7579/MinimalERC7579Account.sol/MinimalERC7579Account.json");
  const MinimalERC7579AccountProxyFactory = artifact(
    "erc7579/MinimalERC7579AccountProxyFactory.sol/MinimalERC7579AccountProxyFactory.json",
  );

  console.log("\nRedeploying ERC-7579 implementation + proxy factory:");
  const erc7579Implementation = await deploy(
    signer, MinimalERC7579Account, [ownerValidator, postTxExecutor], "MinimalERC7579Account (implementation)", n(), fees,
  );
  const erc7579Factory = await deploy(
    signer, MinimalERC7579AccountProxyFactory, [erc7579Implementation], "MinimalERC7579AccountProxyFactory", n(), fees,
  );

  // ── Update the 2 changed VITE_HEGOTA_* lines in frontend/.env in place, leaving every
  // other key (including VITE_HEGOTA_OWNER_VALIDATOR/VITE_HEGOTA_POST_TX_EXECUTOR/
  // VITE_HEGOTA_IN_TOKEN/etc, which don't need to change) and the block markers untouched ──

  const envPath = path.join(FRONTEND, ".env");
  let text = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  text = setEnvVar(text, "VITE_HEGOTA_ERC7579_FACTORY", erc7579Factory);
  text = setEnvVar(text, "VITE_HEGOTA_ERC7579_IMPLEMENTATION", erc7579Implementation);

  console.log(`\nUpdating VITE_HEGOTA_ERC7579_FACTORY / VITE_HEGOTA_ERC7579_IMPLEMENTATION in ${envPath}`);
  writeFileSync(envPath, text);

  console.log(
    "\nDone. Any previously-provisioned ERC-7579 account is now stale (new factory address) -- " +
    "re-provision from /account-setup.\n",
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
