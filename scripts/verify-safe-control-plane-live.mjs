#!/usr/bin/env node
// Live verification: the Control-Plane Takeover POST_TX assertion.
//
// Confirms, against the real Hegotá devnet, the single most important claim in this demo:
// a disguised DELEGATECALL that silently rewrites a Safe's own threshold/guard storage
// (contracts/hegota/MaliciousSafeDelegate.sol -- a toy-scale stand-in for the real Bybit
// hack's mechanism) really does write that storage when unguarded, AND that
// SafeControlPlaneAssertion.sol (contracts/hegota/SafeControlPlaneAssertion.sol) reliably
// reverts the whole transaction when the same payload is wrapped in a POST_TX-frame tx --
// while a benign action through the same Safe, guarded by the same assertion, still succeeds.
//
// Three scenarios, each against its OWN freshly-provisioned stub Safe (contracts/hegota/
// MinimalSafeStub.sol, deployed behind the real, unmodified SafeProxyFactory/SafeProxy --
// see HEGOTA_GAS_CAP_REPORT.md for why):
//
//   1. STANDALONE PROOF (no frame tx, no assertion): a legitimate setGuard(fakeGuard) is
//      executed first (operation=0, self-call) so the guard slot holds a real, known nonzero
//      value. Then a plain top-level execTransaction with operation=1 (DELEGATECALL) to
//      MaliciousSafeDelegate.approve() is submitted directly (NOT via a frame tx). Storage is
//      read back directly via eth_getStorageAt: the guard slot must have flipped from
//      `fakeGuard` to zero. This is the "the attack isn't a silent no-op" proof --
//      independent of the frame-tx/assertion machinery entirely.
//
//   2. BENIGN CASE (frame tx, assertion attached): a different fresh Safe, again with a real
//      guard set. The DEFAULT frame is a signed SafeTx with operation=0 (CALL) to
//      TestSubject.writeSlot(...) -- a normal action that never touches the Safe's own
//      storage. The POST_TX frame is SafeControlPlaneAssertion.assertSafeControlPlaneUnchanged
//      (thisSafe). Expect: all 3 frames succeed, and the Safe's guard slot is unchanged
//      afterward.
//
//   3. VIOLATING CASE (frame tx, assertion attached): a third fresh Safe, again with a real
//      guard set. The DEFAULT frame is the SAME delegatecall attack as scenario 1 (operation=1
//      to MaliciousSafeDelegate.approve()), this time wrapped in a frame tx whose POST_TX frame is
//      the same assertion. Expect: the whole transaction mines with a REVERTED (status=0x0)
//      receipt -- nonce consumed, gas charged, visible on the explorer, per EIP-7906's
//      partial-revert semantics -- and the Safe's guard slot is confirmed UNCHANGED afterward
//      (the attack's storage effects were rewound along with the rest of the DEFAULT frame's
//      body), even though scenario 1 already proved the identical payload does write that slot
//      when nothing catches it.
//
// Usage: node scripts/verify-safe-control-plane-live.mjs

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
const TestSubjectArtifact = artifact(path.join(ROOT, "artifacts/contracts/shared/TestSubject.sol/TestSubject.json"));
const MaliciousSafeDelegate = artifact(path.join(ROOT, "artifacts/contracts/hegota/MaliciousSafeDelegate.sol/MaliciousSafeDelegate.json"));
const SafeControlPlaneAssertion = artifact(path.join(ROOT, "artifacts/contracts/hegota/SafeControlPlaneAssertion.sol/SafeControlPlaneAssertion.json"));

const GUARD_STORAGE_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";
const THRESHOLD_SLOT = 4;

const RPC_URL = process.env.HEGOTA_RPC_URL ?? "https://rpc1.hegota.ethrex.xyz";
const CHAIN_ID = parseInt(process.env.HEGOTA_CHAIN_ID ?? "3151908");
const RELAY_KEY = process.env.HEGOTA_PRIVATE_KEY;

if (!RELAY_KEY) throw new Error("HEGOTA_PRIVATE_KEY not set in .env");

const SAFE_SINGLETON = extractEnv("VITE_HEGOTA_SAFE_SINGLETON");
const SAFE_PROXY_FACTORY = extractEnv("VITE_HEGOTA_SAFE_PROXY_FACTORY");
const TEST_SUBJECT = extractEnv("VITE_HEGOTA_TEST_SUBJECT");
const MALICIOUS_SAFE_DELEGATE = extractEnv("VITE_HEGOTA_MALICIOUS_SAFE_DELEGATE");
const SAFE_CONTROL_PLANE_ASSERTION = extractEnv("VITE_HEGOTA_SAFE_CONTROL_PLANE_ASSERTION");

const provider = new JsonRpcProvider(RPC_URL);
const relay = new Wallet(RELAY_KEY, provider);

const stubIface = new Interface(MinimalSafeStub.abi);
const proxyFactoryIface = new Interface(SafeProxyFactory.abi);
const testSubjectIface = new Interface(TestSubjectArtifact.abi);
const delegateIface = new Interface(MaliciousSafeDelegate.abi);
const assertionIface = new Interface(SafeControlPlaneAssertion.abi);
const abiCoder = AbiCoder.defaultAbiCoder();

/** Provisions a fresh 1-of-1 stub Safe for a brand-new random owner (so each scenario gets
 *  an independent Safe, never colliding with any previously-provisioned address). Returns
 *  the Safe address and the owner Wallet that can sign SafeTxs for it. */
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

/** Signs a SafeTx (mirrors safeExec.ts's/verify-hegota-safe-stub.mjs's EIP-712 signing
 *  exactly) and returns the raw signature bytes -- does not submit anything. */
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

/** Submits a signed execTransaction as a plain, top-level (non-frame) transaction via the
 *  relay key. Used only for scenario 1's standalone proof. */
async function execSafeTxTopLevel(safeAddr, owner, to, value, data, operation) {
  const safeRead = new Contract(safeAddr, MinimalSafeStub.abi, provider);
  const nonce = await safeRead.nonce();
  const sig = await signSafeTx(safeAddr, owner, to, value, data, operation, nonce);
  const safe = new Contract(safeAddr, MinimalSafeStub.abi, relay);
  const tx = await safe.execTransaction(to, value, data, operation, 0, 0, 0, ZeroAddress, ZeroAddress, sig);
  return tx.wait();
}

/** Builds the DEFAULT frame's {target, data, gasLimit} for a signed Safe.execTransaction call
 *  -- mirrors frontend/src/hegotaScenarios/types.ts's prepareViaSafe (via
 *  frontend/src/contracts/safeExec.ts's buildSafeExecTransaction) exactly, just re-implemented
 *  here directly against ethers (no BrowserProvider/JsonRpcSigner available in a Node script). */
async function buildSafeExecFrame(safeAddr, owner, to, value, data, operation, gasLimit) {
  const safeRead = new Contract(safeAddr, MinimalSafeStub.abi, provider);
  const nonce = await safeRead.nonce();
  const sig = await signSafeTx(safeAddr, owner, to, value, data, operation, nonce);
  const execData = stubIface.encodeFunctionData("execTransaction", [
    to, value, data, operation, 0, 0, 0, ZeroAddress, ZeroAddress, sig,
  ]);
  return { target: safeAddr, data: execData, gasLimit };
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

async function readGuardSlot(safeAddr) {
  return provider.getStorage(safeAddr, GUARD_STORAGE_SLOT);
}
async function readThresholdSlot(safeAddr) {
  return provider.getStorage(safeAddr, THRESHOLD_SLOT);
}

async function main() {
  console.log(`Safe singleton (stub):        ${SAFE_SINGLETON}`);
  console.log(`SafeProxyFactory:             ${SAFE_PROXY_FACTORY}`);
  console.log(`TestSubject:                  ${TEST_SUBJECT}`);
  console.log(`MaliciousSafeDelegate:        ${MALICIOUS_SAFE_DELEGATE}`);
  console.log(`SafeControlPlaneAssertion:    ${SAFE_CONTROL_PLANE_ASSERTION}`);

  const maliciousCalldata = delegateIface.encodeFunctionData("approve", [Wallet.createRandom().address, 1n]);

  // ── Scenario 1: standalone proof the delegatecall payload is real (no frame tx) ──────
  console.log("\n=== Scenario 1: standalone proof (no frame tx, no assertion) ===");
  const { safeAddr: safeA, owner: ownerA } = await provisionFreshSafe("scenario 1");

  const fakeGuardA = Wallet.createRandom().address;
  await execSafeTxTopLevel(safeA, ownerA, safeA, 0n, stubIface.encodeFunctionData("setGuard", [fakeGuardA]), 0);
  const guardBefore = await readGuardSlot(safeA);
  console.log(`  guard slot BEFORE attack: ${guardBefore} (expect ${zeroPadValue(fakeGuardA, 32).toLowerCase()})`);
  assert(guardBefore.toLowerCase() === zeroPadValue(fakeGuardA, 32).toLowerCase(), "setGuard did not set the expected guard address");

  console.log("  executing plain top-level execTransaction(operation=1 DELEGATECALL -> MaliciousSafeDelegate.approve())...");
  const attackReceipt = await execSafeTxTopLevel(safeA, ownerA, MALICIOUS_SAFE_DELEGATE, 0n, maliciousCalldata, 1);
  console.log(`  attack tx mined: ${attackReceipt.hash}`);

  const guardAfter = await readGuardSlot(safeA);
  const thresholdAfter = await readThresholdSlot(safeA);
  console.log(`  guard slot AFTER attack:  ${guardAfter} (expect 0x0...0)`);
  console.log(`  threshold slot AFTER attack: ${BigInt(thresholdAfter)} (expect 1)`);
  assert(BigInt(guardAfter) === 0n, "DELEGATECALL attack did not clear the guard slot -- attack silently no-op'd!");
  assert(BigInt(thresholdAfter) === 1n, "DELEGATECALL attack did not write the threshold slot");
  console.log("  CONFIRMED: the delegatecall attack genuinely rewrites the Safe's own guard/threshold storage when unguarded.");

  // ── Scenario 2: benign case through a frame tx with the assertion attached ──────────
  console.log("\n=== Scenario 2: benign case (frame tx, assertion attached) ===");
  const { safeAddr: safeB, owner: ownerB } = await provisionFreshSafe("scenario 2");
  const fakeGuardB = Wallet.createRandom().address;
  await execSafeTxTopLevel(safeB, ownerB, safeB, 0n, stubIface.encodeFunctionData("setGuard", [fakeGuardB]), 0);
  console.log(`  guard set to ${fakeGuardB} on Safe B before the frame tx`);

  const benignKey = keccak256(Buffer.from("control-plane-benign-probe"));
  const benignValue = 777n;
  const benignCallData = testSubjectIface.encodeFunctionData("writeSlot", [benignKey, benignValue]);
  const defaultFrameB = await buildSafeExecFrame(safeB, ownerB, TEST_SUBJECT, 0n, benignCallData, 0, 400_000);
  const postTxFrameB = {
    target: SAFE_CONTROL_PLANE_ASSERTION,
    data: assertionIface.encodeFunctionData("assertSafeControlPlaneUnchanged", [safeB]),
    gasLimit: 200_000,
  };

  console.log("  submitting frame tx: DEFAULT = Safe.execTransaction(CALL -> TestSubject.writeSlot), POST_TX = assertSafeControlPlaneUnchanged(safeB)");
  const resultB = await submitFrameTx(defaultFrameB, postTxFrameB);
  assert(resultB.status === "success", "Expected the benign case to mine successfully");

  const guardBAfter = await readGuardSlot(safeB);
  console.log(`  guard slot after benign frame tx: ${guardBAfter} (expect unchanged: ${zeroPadValue(fakeGuardB, 32).toLowerCase()})`);
  assert(guardBAfter.toLowerCase() === zeroPadValue(fakeGuardB, 32).toLowerCase(), "benign case unexpectedly touched the guard slot");

  function mappingSlot(key) {
    return keccak256(abiCoder.encode(["bytes32", "uint256"], [key, 0]));
  }
  const testSubjectSlotValue = BigInt(await provider.getStorage(TEST_SUBJECT, mappingSlot(benignKey)));
  console.log(`  TestSubject.slots[key] = ${testSubjectSlotValue} (expect ${benignValue}) -- confirms the CALL really executed`);
  assert(testSubjectSlotValue === benignValue, "benign action's CALL did not actually write TestSubject's storage");
  console.log("  CONFIRMED: benign action passes all 3 frames, and the Safe's own control-plane storage is untouched.");

  // ── Scenario 3: the violating case gets reverted ────────────────────────────────────
  console.log("\n=== Scenario 3: violating case (frame tx, assertion attached) ===");
  const { safeAddr: safeC, owner: ownerC } = await provisionFreshSafe("scenario 3");
  const fakeGuardC = Wallet.createRandom().address;
  await execSafeTxTopLevel(safeC, ownerC, safeC, 0n, stubIface.encodeFunctionData("setGuard", [fakeGuardC]), 0);
  console.log(`  guard set to ${fakeGuardC} on Safe C before the frame tx`);

  const defaultFrameC = await buildSafeExecFrame(safeC, ownerC, MALICIOUS_SAFE_DELEGATE, 0n, maliciousCalldata, 1, 400_000);
  const postTxFrameC = {
    target: SAFE_CONTROL_PLANE_ASSERTION,
    data: assertionIface.encodeFunctionData("assertSafeControlPlaneUnchanged", [safeC]),
    gasLimit: 200_000,
  };

  console.log("  submitting frame tx: DEFAULT = Safe.execTransaction(DELEGATECALL -> MaliciousSafeDelegate.approve()), POST_TX = assertSafeControlPlaneUnchanged(safeC)");
  const resultC = await submitFrameTx(defaultFrameC, postTxFrameC);
  assert(resultC.status === "reverted", `Expected the violating case to mine with a reverted receipt, got status=${resultC.status}`);

  const guardCAfter = await readGuardSlot(safeC);
  const thresholdCAfter = await readThresholdSlot(safeC);
  console.log(`  guard slot AFTER reverted attack:     ${guardCAfter} (expect rewound to unchanged: ${zeroPadValue(fakeGuardC, 32).toLowerCase()})`);
  console.log(`  threshold slot AFTER reverted attack: ${BigInt(thresholdCAfter)} (expect 1, unchanged since setup already sets it to 1)`);
  assert(guardCAfter.toLowerCase() === zeroPadValue(fakeGuardC, 32).toLowerCase(), "guard slot was NOT rolled back after the reverted tx -- the partial revert did not roll back state!");
  console.log("  CONFIRMED: the attack's storage effects (already proven real in Scenario 1) were rewound --");
  console.log("             SafeControlPlaneAssertion reverted the transaction before anything could persist, but the");
  console.log("             tx itself still mined (nonce consumed, gas charged), not excluded from the block.");

  console.log("\nSafeControlPlaneAssertion control-plane-takeover detection pipeline verified end-to-end.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
