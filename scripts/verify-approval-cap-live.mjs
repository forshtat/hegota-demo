#!/usr/bin/env node
// Live check for the Unlimited Approval POST_TX assertion: builds a real EIP-8141 frame
// transaction whose DEFAULT frame calls IN_TOKEN.approve(spender, amount) and whose POST_TX
// frame calls ApprovalCapAssertion.assertApprovalCap(...) with an LTE Constraint on a fixed
// demo cap. Two scenarios:
//   1. Passing case: approve an amount at/under the cap -- all three frames succeed.
//   2. Violating case: approve type(uint256).max (the "infinite approval" pattern) -- the
//      POST_TX frame reverts on ConstraintViolated. The tx still mines (nonce consumed, gas
//      charged) but with a failure receipt -- EIP-7906's partial-revert semantics, not exclusion.
//
// Usage: node scripts/verify-approval-cap-live.mjs

import "dotenv/config";
import { JsonRpcProvider, Wallet, Interface, getBytes, AbiCoder, MaxUint256 } from "ethers";
import { readFileSync } from "fs";
import { Frame, FrameMode, FrameSig, FrameTx, SigScheme, hex } from "../frontend/src/frametx.ts";

function readFrontendEnv(key) {
  const text = readFileSync(new URL("../frontend/.env", import.meta.url), "utf8");
  const m = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
}

const RPC_URL = process.env.HEGOTA_RPC_URL ?? "https://rpc1.hegota.ethrex.xyz";
const CHAIN_ID = parseInt(process.env.HEGOTA_CHAIN_ID ?? "3151908");
const RELAY_KEY = process.env.HEGOTA_PRIVATE_KEY;
const IN_TOKEN = readFrontendEnv("VITE_HEGOTA_IN_TOKEN");
const MOCK_SWAP = readFrontendEnv("VITE_HEGOTA_MOCK_SWAP"); // reused as the demo's "spender"
const APPROVAL_CAP_ASSERTION = readFrontendEnv("VITE_HEGOTA_APPROVAL_CAP_ASSERTION");

if (!RELAY_KEY) throw new Error("HEGOTA_PRIVATE_KEY not set in .env");
if (!IN_TOKEN || !MOCK_SWAP || !APPROVAL_CAP_ASSERTION) {
  throw new Error("Run `node scripts/deploy-hegota.mjs` first (and deploy ApprovalCapAssertion)");
}

const provider = new JsonRpcProvider(RPC_URL);
const relay = new Wallet(RELAY_KEY, provider);
const abiCoder = AbiCoder.defaultAbiCoder();

const tokenIface = new Interface([
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const assertionIface = new Interface([
  "function assertApprovalCap(address token, address spender, tuple(uint8 constraintType, bytes referenceData) capConstraint) view",
]);

const ConstraintType = { EQ: 0, GTE: 1, LTE: 2, IN: 3 };

const APPROVAL_CAP = 1_000n * 10n ** 18n;
const COMPLIANT_AMOUNT = 500n * 10n ** 18n;

async function runScenario(label, amount) {
  console.log(`\n=== ${label} ===`);
  console.log(`approving: ${amount === MaxUint256 ? "type(uint256).max" : amount.toString()}  cap: ${APPROVAL_CAP}`);

  const referenceData = abiCoder.encode(["uint256"], [APPROVAL_CAP]);
  const constraint = { constraintType: ConstraintType.LTE, referenceData };

  const approveData = getBytes(tokenIface.encodeFunctionData("approve", [MOCK_SWAP, amount]));
  const assertionData = getBytes(
    assertionIface.encodeFunctionData("assertApprovalCap", [IN_TOKEN, MOCK_SWAP, constraint]),
  );

  const sender = relay.address;
  // "latest", not "pending" -- see hegotaMinOutput.ts's sandwichRate for why.
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
        // A plain ERC-20 approve() needs only ~8k gas as an ordinary top-level transaction, but
        // measured live against Hegotá, the identical call inside a frame tx's DEFAULT frame
        // consumes ~105k gas (empirically confirmed while building this script) -- frame
        // execution appears to carry substantially higher overhead than a top-level call here.
        // 300k leaves generous headroom above that measured figure.
        new Frame(FrameMode.DEFAULT, 0, IN_TOKEN, 300_000, 0, approveData),
        new Frame(FrameMode.POST_TX, 0, APPROVAL_CAP_ASSERTION, 200_000, 0, assertionData),
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
  console.log(`submitted ${txHash}`);
  console.log(`Dora: https://dora.hegota.ethrex.xyz/tx/${txHash}`);

  for (let i = 0; i < 20; i++) {
    const receipt = await provider.send("eth_getTransactionReceipt", [txHash]);
    if (receipt) {
      console.log(`MINED status=${receipt.status} frameReceipts=${JSON.stringify(receipt.frameReceipts)}`);
      return receipt.status === "0x1";
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log("NO RECEIPT within poll window (unexpected -- see hegotaWallet.ts's exclusion fallback)");
  return null;
}

async function main() {
  const passed = await runScenario("passing case (approve at/under cap)", COMPLIANT_AMOUNT);
  if (passed !== true) throw new Error("Expected the passing case to mine successfully");

  const reverted = await runScenario("violating case (approve type(uint256).max)", MaxUint256);
  if (reverted !== false) throw new Error("Expected the violating case to mine with a reverted (status=0x0) receipt");

  console.log("\nApprovalCapAssertion cap-enforcement pipeline verified.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
