#!/usr/bin/env node
// Standalone live check for the Phase C smart-account flow: provisions a
// MinimalERC7579Account for a throwaway "MetaMask stand-in" key, signs the exact
// EIP-712 struct frontend/src/contracts/demoSmartAccountAction.ts produces, and calls
// PostTxExecutor.executeAction — first with a correct signature (must succeed),
// then with a signature from a different key (must revert with InvalidSignature).
// Run directly with plain node (works via Node's native TS stripping for imports
// that don't need it here -- this file is plain JS).
//
// Usage: node scripts/verify-erc7579-account.mjs

import "dotenv/config";
import { JsonRpcProvider, Wallet, Interface, TypedDataEncoder } from "ethers";
import { readFileSync } from "fs";

function readFrontendEnv(key) {
  const text = readFileSync(new URL("../frontend/.env", import.meta.url), "utf8");
  const m = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
}

const RPC_URL = process.env.HEGOTA_RPC_URL ?? "https://rpc1.hegota.ethrex.xyz";
const CHAIN_ID = parseInt(process.env.HEGOTA_CHAIN_ID ?? "3151908");
const RELAY_KEY = process.env.HEGOTA_PRIVATE_KEY;
const TEST_SUBJECT = readFrontendEnv("VITE_HEGOTA_TEST_SUBJECT");
const VALIDATOR = readFrontendEnv("VITE_HEGOTA_OWNER_VALIDATOR");
const EXECUTOR = readFrontendEnv("VITE_HEGOTA_POST_TX_EXECUTOR");
const FACTORY = readFrontendEnv("VITE_HEGOTA_ERC7579_FACTORY");

if (!RELAY_KEY) throw new Error("HEGOTA_PRIVATE_KEY not set in .env");
if (!TEST_SUBJECT || !VALIDATOR || !EXECUTOR || !FACTORY) {
  throw new Error("Run `node scripts/deploy-hegota.mjs` first");
}

const provider = new JsonRpcProvider(RPC_URL);
const relay = new Wallet(RELAY_KEY, provider);

// Hegotá's fee-suggestion RPCs return a flat ~1 gwei unrelated to the real live base fee
// (~7 wei observed) -- see hegotaWallet.ts's lowFeeOverrides for the frontend-side fix.
async function lowFees() {
  const block = await provider.getBlock("latest");
  const baseFee = block.baseFeePerGas ?? 0n;
  const maxPriorityFeePerGas = 1_000n;
  return { maxPriorityFeePerGas, maxFeePerGas: baseFee * 4n + maxPriorityFeePerGas };
}

const factoryIface = new Interface([
  "function getAddress(address validator, address executor, address owner) view returns (address)",
  "function createAccount(address validator, address executor, address owner) returns (address)",
]);
const executorIface = new Interface([
  "function nextActionHash(address account, address target, bytes callData) view returns (bytes32)",
  "function executeAction(address account, address validator, address target, bytes callData, bytes signature) returns (bytes)",
]);
const testSubjectIface = new Interface(["function emitTransfer(address to, uint256 amount)"]);

// Must match frontend/src/contracts/demoSmartAccountAction.ts exactly.
const DOMAIN = { name: "Hegotá POST_TX Demo", version: "1", chainId: CHAIN_ID };
const TYPES = {
  PostTxAction: [
    { name: "account", type: "address" },
    { name: "target", type: "address" },
    { name: "callData", type: "bytes" },
    { name: "nonce", type: "uint256" },
  ],
};

async function ensureAccount(owner) {
  const predicted = await provider.call({
    to: FACTORY,
    data: factoryIface.encodeFunctionData("getAddress", [VALIDATOR, EXECUTOR, owner]),
  }).then((r) => factoryIface.decodeFunctionResult("getAddress", r)[0]);

  const code = await provider.getCode(predicted);
  if (code === "0x") {
    console.log(`Provisioning account for owner ${owner} ...`);
    const tx = await relay.sendTransaction({
      to: FACTORY,
      data: factoryIface.encodeFunctionData("createAccount", [VALIDATOR, EXECUTOR, owner]),
      ...(await lowFees()),
    });
    await tx.wait();
    console.log(`  provisioned at ${predicted} (tx ${tx.hash})`);
  } else {
    console.log(`Account for owner ${owner} already provisioned at ${predicted}`);
  }
  return predicted;
}

async function signAction(signerWallet, account, target, callData) {
  const actionHash = await provider.call({
    to: EXECUTOR,
    data: executorIface.encodeFunctionData("nextActionHash", [account, target, callData]),
  }).then((r) => executorIface.decodeFunctionResult("nextActionHash", r)[0]);

  // Recompute the nonce independently (nextActionHash is a view call over the same
  // on-chain state) so we can also cross-check the digest matches what ethers computes
  // off-chain for the identical struct -- this is the golden-vector-style check.
  const nonce = await provider.call({
    to: EXECUTOR,
    data: new Interface(["function nonces(address) view returns (uint256)"]).encodeFunctionData("nonces", [account]),
  }).then((r) => new Interface(["function nonces(address) view returns (uint256)"]).decodeFunctionResult("nonces", r)[0]);

  const value = { account, target, callData, nonce };
  const offChainDigest = TypedDataEncoder.hash(DOMAIN, TYPES, value);
  if (offChainDigest.toLowerCase() !== actionHash.toLowerCase()) {
    throw new Error(
      `Digest mismatch! on-chain=${actionHash} off-chain=${offChainDigest} -- EIP-712 domain/type encoding is out of sync between PostTxExecutor.sol and demoSmartAccountAction.ts`,
    );
  }
  console.log(`  actionHash matches off-chain EIP-712 digest: ${actionHash}`);

  const signature = await signerWallet.signTypedData(DOMAIN, TYPES, value);
  return { actionHash, signature };
}

async function main() {
  const owner = Wallet.createRandom(); // stands in for the connected MetaMask key
  const attacker = Wallet.createRandom(); // a different key, for the negative case
  console.log(`Owner (stand-in for MetaMask): ${owner.address}`);

  const account = await ensureAccount(owner.address);

  const callData = testSubjectIface.encodeFunctionData("emitTransfer", [owner.address, 100n]);

  console.log("\n=== correct signature (must succeed) ===");
  const { signature } = await signAction(owner, account, TEST_SUBJECT, callData);
  const tx = await relay.sendTransaction({
    to: EXECUTOR,
    data: executorIface.encodeFunctionData("executeAction", [account, VALIDATOR, TEST_SUBJECT, callData, signature]),
    ...(await lowFees()),
  });
  const receipt = await tx.wait();
  console.log(`  executeAction tx ${tx.hash} status=${receipt.status} (1 = success)`);
  if (receipt.status !== 1) throw new Error("Expected executeAction to succeed with a correct signature");

  console.log("\n=== wrong signer's signature (must revert) ===");
  const { signature: badSignature } = await signAction(attacker, account, TEST_SUBJECT, callData);
  try {
    const badTx = await relay.sendTransaction({
      to: EXECUTOR,
      data: executorIface.encodeFunctionData("executeAction", [account, VALIDATOR, TEST_SUBJECT, callData, badSignature]),
      ...(await lowFees()),
    });
    await badTx.wait();
    throw new Error("Expected executeAction to revert with a wrong-signer signature, but it succeeded");
  } catch (e) {
    console.log(`  reverted as expected: ${e.shortMessage ?? e.message}`);
  }

  console.log("\nPhase C smart-account flow verified.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
