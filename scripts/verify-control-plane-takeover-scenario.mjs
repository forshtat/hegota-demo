#!/usr/bin/env node
// Live verification: exercises the ACTUAL calldata frontend/src/hegotaScenarios/
// controlPlaneTakeoverScenario.ts produces (buildSafeAction's compliant/violating variants +
// buildAssertionFrame), against the contracts frontend/.env currently points at
// (MaliciousSafeDelegate, SafeControlPlaneAssertion, BenignSafeDelegate).
//
//   1. Confirm BenignSafeDelegate.noop() -- the compliant DELEGATECALL target
//      controlPlaneTakeoverScenario.ts's buildSafeAction(triggerViolation=false) points at --
//      really is DELEGATECALL-safe: after a frame tx whose DEFAULT frame delegatecalls into it,
//      the Safe's guard slot AND threshold slot are byte-for-byte unchanged, and the frame tx
//      succeeds (SafeControlPlaneAssertion does not fire).
//   2. Confirm the violating variant (MaliciousSafeDelegate.approve(), same calldata shape
//      buildSafeAction(triggerViolation=true) produces) gets reverted (mined with a failure
//      receipt, state rewound to its pre-attack value -- not excluded from the block).
//
// Usage: node scripts/verify-control-plane-takeover-scenario.mjs

import "dotenv/config";
import {
  JsonRpcProvider, Wallet, Interface, Contract, ZeroAddress,
  zeroPadValue, toBeHex, keccak256, AbiCoder, getBytes,
} from "ethers";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Frame, FrameMode, FrameSig, FrameTx, SigScheme, hex } from "../frontend/src/frametx.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function artifact(fullPath) {
  return JSON.parse(readFileSync(fullPath, "utf8"));
}

function extractEnv(key) {
  const content = readFileSync(path.join(ROOT, "frontend/.env"), "utf8");
  const match = content.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) throw new Error(`${key} not found in frontend/.env`);
  return match[1].trim();
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

const MinimalSafeStub = artifact(path.join(ROOT, "artifacts/contracts/hegota/MinimalSafeStub.sol/MinimalSafeStub.json"));
const SafeProxyFactory = artifact(path.join(
  ROOT, "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json",
));
const MaliciousSafeDelegate = artifact(path.join(ROOT, "artifacts/contracts/hegota/MaliciousSafeDelegate.sol/MaliciousSafeDelegate.json"));
const BenignSafeDelegate = artifact(path.join(ROOT, "artifacts/contracts/hegota/BenignSafeDelegate.sol/BenignSafeDelegate.json"));
const SafeControlPlaneAssertion = artifact(path.join(ROOT, "artifacts/contracts/hegota/SafeControlPlaneAssertion.sol/SafeControlPlaneAssertion.json"));

const GUARD_STORAGE_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";
const THRESHOLD_SLOT = 4;

const RPC_URL = process.env.HEGOTA_RPC_URL ?? "https://rpc1.hegota.ethrex.xyz";
const CHAIN_ID = parseInt(process.env.HEGOTA_CHAIN_ID ?? "3151908");
const RELAY_KEY = process.env.HEGOTA_PRIVATE_KEY;

if (!RELAY_KEY) throw new Error("HEGOTA_PRIVATE_KEY not set in .env");

const SAFE_SINGLETON = extractEnv("VITE_HEGOTA_SAFE_SINGLETON");
const SAFE_PROXY_FACTORY = extractEnv("VITE_HEGOTA_SAFE_PROXY_FACTORY");
const MALICIOUS_SAFE_DELEGATE = extractEnv("VITE_HEGOTA_MALICIOUS_SAFE_DELEGATE");
const BENIGN_SAFE_DELEGATE = extractEnv("VITE_HEGOTA_BENIGN_SAFE_DELEGATE");
const SAFE_CONTROL_PLANE_ASSERTION = extractEnv("VITE_HEGOTA_SAFE_CONTROL_PLANE_ASSERTION");

console.log(`MaliciousSafeDelegate:     ${MALICIOUS_SAFE_DELEGATE}`);
console.log(`BenignSafeDelegate:        ${BENIGN_SAFE_DELEGATE}`);
console.log(`SafeControlPlaneAssertion: ${SAFE_CONTROL_PLANE_ASSERTION}`);

const provider = new JsonRpcProvider(RPC_URL);
const relay = new Wallet(RELAY_KEY, provider);

const stubIface = new Interface(MinimalSafeStub.abi);
const proxyFactoryIface = new Interface(SafeProxyFactory.abi);
const delegateIface = new Interface(MaliciousSafeDelegate.abi);
const benignIface = new Interface(BenignSafeDelegate.abi);
const assertionIface = new Interface(SafeControlPlaneAssertion.abi);
const abiCoder = AbiCoder.defaultAbiCoder();

async function provisionFreshSafe(label) {
  const owner = Wallet.createRandom();
  const setupData = stubIface.encodeFunctionData("setup", [
    [owner.address], 1, ZeroAddress, "0x", ZeroAddress, ZeroAddress, 0, ZeroAddress,
  ]);
  const saltNonce = BigInt(keccak256(abiCoder.encode(["address"], [owner.address])));

  const proxyFactory = new Contract(SAFE_PROXY_FACTORY, SafeProxyFactory.abi, relay);
  const tx = await proxyFactory.createProxyWithNonce(SAFE_SINGLETON, setupData, saltNonce);
  const receipt = await tx.wait();
  const proxyCreationTopic = keccak256(Buffer.from("ProxyCreation(address,address)"));
  const log = receipt.logs.find((l) => l.topics[0] === proxyCreationTopic);
  if (!log) throw new Error("ProxyCreation event not found");
  const safeAddr = "0x" + log.topics[1].slice(26);
  console.log(`[${label}] provisioned Safe ${safeAddr} (owner ${owner.address})`);
  return { safeAddr, owner };
}

async function signSafeTx(safeAddr, owner, to, value, data, operation, nonce) {
  const chainId = (await provider.getNetwork()).chainId;
  return owner.signTypedData(
    { chainId, verifyingContract: safeAddr },
    { SafeTx: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "nonce", type: "uint256" },
    ] },
    { to, value, data, operation, safeTxGas: 0n, baseGas: 0n,
      gasPrice: 0n, gasToken: ZeroAddress, refundReceiver: ZeroAddress, nonce },
  );
}

async function execSafeTxTopLevel(safeAddr, owner, to, value, data, operation) {
  const safeRead = new Contract(safeAddr, MinimalSafeStub.abi, provider);
  const nonce = await safeRead.nonce();
  const sig = await signSafeTx(safeAddr, owner, to, value, data, operation, nonce);
  const safe = new Contract(safeAddr, MinimalSafeStub.abi, relay);
  const tx = await safe.execTransaction(to, value, data, operation, 0, 0, 0, ZeroAddress, ZeroAddress, sig);
  return tx.wait();
}

// Mirrors prepareViaSafe (frontend/src/hegotaScenarios/types.ts) via buildSafeExecTransaction
// (frontend/src/contracts/safeExec.ts) EXACTLY: operation is always 1 (DELEGATECALL), matching
// the fact that prepareViaSafe has no CALL-mode escape hatch.
async function buildSafeExecFrame(safeAddr, owner, to, data, gasLimit) {
  const safeRead = new Contract(safeAddr, MinimalSafeStub.abi, provider);
  const nonce = await safeRead.nonce();
  const operation = 1; // DELEGATECALL, per prepareViaSafe
  const sig = await signSafeTx(safeAddr, owner, to, 0n, data, operation, nonce);
  const execData = stubIface.encodeFunctionData("execTransaction", [
    to, 0n, data, operation, 0, 0, 0, ZeroAddress, ZeroAddress, sig,
  ]);
  return { target: safeAddr, data: execData, gasLimit };
}

// Mirrors controlPlaneTakeoverScenario.ts's buildAssertionCall exactly.
function buildAssertionFrame(safeAddr) {
  return {
    target: SAFE_CONTROL_PLANE_ASSERTION,
    data: assertionIface.encodeFunctionData("assertSafeControlPlaneUnchanged", [safeAddr]),
    gasLimit: 200_000,
  };
}

async function submitFrameTx(defaultFrame, postTxFrame) {
  const sender = relay.address;
  const nonce = await provider.send("eth_getTransactionCount", [sender, "latest"]);
  const block = await provider.send("eth_getBlockByNumber", ["latest", false]);
  const nonceSeq = BigInt(nonce);
  const baseFee = BigInt(block.baseFeePerGas ?? "0x0");
  // See hegotaWallet.ts's lowFeeOverrides comment: Hegotá's fee-suggestion RPCs return a
  // flat ~1 gwei unrelated to the real live base fee (~7 wei observed); bidding that would
  // drain the relay key's low, non-renewable balance ~1,000,000x faster than necessary.
  const maxPriorityFee = 1_000n;
  const maxFee = baseFee * 4n + maxPriorityFee;

  function build(sig) {
    return new FrameTx({
      chainId: CHAIN_ID, nonceKeys: [0], nonceSeq, sender,
      frames: [
        new Frame(FrameMode.VERIFY, 0x03, sender, 80_000, 0, new Uint8Array(0)),
        new Frame(FrameMode.DEFAULT, 0, defaultFrame.target, defaultFrame.gasLimit, 0, getBytes(defaultFrame.data)),
        new Frame(FrameMode.POST_TX, 0, postTxFrame.target, postTxFrame.gasLimit, 0, getBytes(postTxFrame.data)),
      ],
      signatures: [sig], maxPriorityFee, maxFee,
    });
  }
  const unsigned = build(new FrameSig(SigScheme.SECP256K1, sender, new Uint8Array(0), new Uint8Array(0)));
  const sigHashBytes = unsigned.sigHash();
  const relaySig = relay.signingKey.sign(sigHashBytes);
  const sigBytes = new Uint8Array(65);
  sigBytes[0] = relaySig.yParity;
  sigBytes.set(getBytes(relaySig.r), 1);
  sigBytes.set(getBytes(relaySig.s), 33);
  const tx = build(new FrameSig(SigScheme.SECP256K1, sender, new Uint8Array(0), sigBytes));
  const rawHex = hex(tx.raw());

  const txHash = await provider.send("eth_sendRawTransaction", [rawHex]);
  console.log(`  submitted ${txHash}`);
  console.log(`  Dora: https://dora.hegota.ethrex.xyz/tx/${txHash}`);

  for (let i = 0; i < 20; i++) {
    const receipt = await provider.send("eth_getTransactionReceipt", [txHash]);
    if (receipt) {
      console.log(`  MINED status=${receipt.status} frameReceipts=${JSON.stringify(receipt.frameReceipts)}`);
      return { status: receipt.status === "0x1" ? "success" : "reverted", txHash };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  const nonceAfter = BigInt(await provider.send("eth_getTransactionCount", [sender, "latest"]));
  console.log(`  NO RECEIPT within poll window (unexpected; nonce before=${nonceSeq} after=${nonceAfter})`);
  return { status: "excluded", txHash, nonceAdvanced: nonceAfter > nonceSeq };
}

async function readGuardSlot(safeAddr) { return provider.getStorage(safeAddr, GUARD_STORAGE_SLOT); }
async function readThresholdSlot(safeAddr) { return provider.getStorage(safeAddr, THRESHOLD_SLOT); }

async function main() {
  // MaliciousSafeDelegate.approve(spender, amount) is named to collide with ERC-20's approve
  // selector (fooling a signing UI into decoding it as a routine approval) -- both parameters
  // are ignored by the contract itself, only the DELEGATECALL's storage-rewrite matters here.
  const maliciousCalldata = delegateIface.encodeFunctionData("approve", [Wallet.createRandom().address, 1n]);
  const noopCalldata = benignIface.encodeFunctionData("noop", []);

  // ── Scenario A: controlPlaneTakeoverScenario's COMPLIANT variant (BenignSafeDelegate.noop())
  console.log("\n=== Scenario A: compliant buildSafeAction (BenignSafeDelegate.noop(), frame tx, assertion attached) ===");
  const { safeAddr: safeA, owner: ownerA } = await provisionFreshSafe("scenario A");
  const fakeGuardA = Wallet.createRandom().address;
  await execSafeTxTopLevel(safeA, ownerA, safeA, 0n, stubIface.encodeFunctionData("setGuard", [fakeGuardA]), 0);
  const guardBeforeA = await readGuardSlot(safeA);
  const thresholdBeforeA = await readThresholdSlot(safeA);
  console.log(`  guard slot BEFORE: ${guardBeforeA}, threshold slot BEFORE: ${BigInt(thresholdBeforeA)}`);
  assert(guardBeforeA.toLowerCase() === zeroPadValue(fakeGuardA, 32).toLowerCase(), "setGuard did not set the expected guard address");

  const defaultFrameA = await buildSafeExecFrame(safeA, ownerA, BENIGN_SAFE_DELEGATE, noopCalldata, 400_000);
  const postTxFrameA = buildAssertionFrame(safeA);
  console.log("  submitting frame tx: DEFAULT = Safe.execTransaction(DELEGATECALL -> BenignSafeDelegate.noop()), POST_TX = assertSafeControlPlaneUnchanged(safeA)");
  const resultA = await submitFrameTx(defaultFrameA, postTxFrameA);
  assert(resultA.status === "success", "Expected controlPlaneTakeoverScenario's compliant variant to mine successfully");

  const guardAfterA = await readGuardSlot(safeA);
  const thresholdAfterA = await readThresholdSlot(safeA);
  console.log(`  guard slot AFTER:  ${guardAfterA} (expect unchanged)`);
  console.log(`  threshold slot AFTER: ${BigInt(thresholdAfterA)} (expect unchanged: ${BigInt(thresholdBeforeA)})`);
  assert(guardAfterA.toLowerCase() === guardBeforeA.toLowerCase(), "BenignSafeDelegate.noop() unexpectedly touched the guard slot!");
  assert(BigInt(thresholdAfterA) === BigInt(thresholdBeforeA), "BenignSafeDelegate.noop() unexpectedly touched the threshold slot!");
  console.log("  CONFIRMED: BenignSafeDelegate.noop() is genuinely DELEGATECALL-safe -- the compliant variant");
  console.log("             leaves the Safe's control-plane storage completely untouched, and the frame tx succeeds.");

  // ── Scenario B: controlPlaneTakeoverScenario's VIOLATING variant (MaliciousSafeDelegate.approve())
  console.log("\n=== Scenario B: violating buildSafeAction (MaliciousSafeDelegate.approve(), frame tx, assertion attached) ===");
  const { safeAddr: safeB, owner: ownerB } = await provisionFreshSafe("scenario B");
  const fakeGuardB = Wallet.createRandom().address;
  await execSafeTxTopLevel(safeB, ownerB, safeB, 0n, stubIface.encodeFunctionData("setGuard", [fakeGuardB]), 0);
  console.log(`  guard set to ${fakeGuardB} on Safe B before the frame tx`);

  const defaultFrameB = await buildSafeExecFrame(safeB, ownerB, MALICIOUS_SAFE_DELEGATE, maliciousCalldata, 400_000);
  const postTxFrameB = buildAssertionFrame(safeB);
  console.log("  submitting frame tx: DEFAULT = Safe.execTransaction(DELEGATECALL -> MaliciousSafeDelegate.approve()), POST_TX = assertSafeControlPlaneUnchanged(safeB)");
  const resultB = await submitFrameTx(defaultFrameB, postTxFrameB);
  assert(resultB.status === "reverted", `Expected controlPlaneTakeoverScenario's violating variant to mine with a reverted receipt, got status=${resultB.status}`);

  const guardAfterB = await readGuardSlot(safeB);
  console.log(`  guard slot AFTER reverted attack: ${guardAfterB} (expect rewound to unchanged: ${zeroPadValue(fakeGuardB, 32).toLowerCase()})`);
  assert(guardAfterB.toLowerCase() === zeroPadValue(fakeGuardB, 32).toLowerCase(), "guard slot was NOT rolled back after the reverted tx!");
  console.log("  CONFIRMED: the violating variant (freshly redeployed MaliciousSafeDelegate/SafeControlPlaneAssertion,");
  console.log("             the exact addresses now wired into frontend/.env) still reverts end-to-end -- mined with a");
  console.log("             failure receipt and the Safe's control-plane storage rewound, not excluded from the block.");

  console.log("\ncontrolPlaneTakeoverScenario.ts's buildSafeAction/buildAssertionFrame calldata verified end-to-end on Hegotá.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
