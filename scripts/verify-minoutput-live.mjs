#!/usr/bin/env node
// Live check for the MinOutput / anti-sandwich POST_TX assertion: builds a real EIP-8141
// frame transaction whose DEFAULT frame calls MockSwap.swap(...) and whose POST_TX frame
// calls MinOutputAssertion.assertMinOutput(...) with a GTE Constraint on the predicted
// output amount (mirrors the "simulate -> commit -> enforce" pipeline the hardware-wallet
// widget will drive from the browser). Two scenarios:
//   1. Passing case: quote off live pool price state, commit to that value, submit
//      unchanged -- the real outcome matches, all three frames succeed.
//   2. Sandwich case: quote, commit, then move MockSwap's rate down (as an attacker
//      front-running the swap would) before submitting -- the real output falls below the
//      committed minimum, so the POST_TX frame reverts. The tx still mines (nonce consumed,
//      gas charged) but with a failure receipt -- EIP-7906's partial-revert semantics, not
//      exclusion.
//
// Usage: node scripts/verify-minoutput-live.mjs

import "dotenv/config";
import { JsonRpcProvider, Wallet, Interface, getBytes, AbiCoder } from "ethers";
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
const OUT_TOKEN = readFrontendEnv("VITE_HEGOTA_OUT_TOKEN");
const MOCK_SWAP = readFrontendEnv("VITE_HEGOTA_MOCK_SWAP");
const MIN_OUTPUT_ASSERTION = readFrontendEnv("VITE_HEGOTA_MIN_OUTPUT_ASSERTION");

if (!RELAY_KEY) throw new Error("HEGOTA_PRIVATE_KEY not set in .env");
if (!IN_TOKEN || !OUT_TOKEN || !MOCK_SWAP || !MIN_OUTPUT_ASSERTION) {
  throw new Error("Run `node scripts/deploy-hegota.mjs` first");
}

const provider = new JsonRpcProvider(RPC_URL);
const relay = new Wallet(RELAY_KEY, provider);
const abiCoder = AbiCoder.defaultAbiCoder();

// Read MockSwap's ABI from the compiled artifact rather than restating it here. The
// hand-written copy silently drifted when MockSwap moved to per-recipient rates:
// `rateNumerator()` and `setRate(uint256)` became `rateNumerator(address)` and
// `setRate(address,uint256)`, so every call hit a selector the deployed contract does not
// have and came back as a bare revert. The frontend never broke because it already reads
// this artifact (frontend/src/contracts/abis.ts).
const swapIface = new Interface(
  JSON.parse(readFileSync(new URL("../artifacts/contracts/hegota/MockSwap.sol/MockSwap.json", import.meta.url), "utf8")).abi,
);
const assertionIface = new Interface([
  "function assertMinOutput(address token, address recipient, tuple(uint8 constraintType, bytes referenceData) outputConstraint) view",
]);

const ConstraintType = { EQ: 0, GTE: 1, LTE: 2, IN: 3 };
const RATE_DENOMINATOR = 10n ** 18n; // mirrors MockSwap.sol's constant

async function readRate(recipient) {
  const data = swapIface.encodeFunctionData("rateNumerator", [recipient]);
  const result = await provider.call({ to: MOCK_SWAP, data });
  return swapIface.decodeFunctionResult("rateNumerator", result)[0];
}

// Mirrors what the hardware-wallet widget does: reads live pool price state and applies
// MockSwap's own pricing formula client-side, rather than calling the mutating `swap`
// function and trusting its return value (most real swap functions don't return anything
// trustworthy to simulate off of anyway).
async function quoteSwap(amountIn) {
  const rate = await readRate(relay.address);
  return (amountIn * rate) / RATE_DENOMINATOR;
}

async function runScenario(label, amountIn, sandwich) {
  console.log(`\n=== ${label} ===`);

  // 1. Quote (this is what the hardware-wallet widget would do).
  const predictedOut = await quoteSwap(amountIn);
  console.log(`quoted output: ${predictedOut}`);

  // 2. Commit: build the GTE Constraint on the simulated value.
  const referenceData = abiCoder.encode(["uint256"], [predictedOut]);
  const constraint = { constraintType: ConstraintType.GTE, referenceData };

  // 3. If modeling a sandwich attack, move the price down now -- after committing,
  // before the real transaction executes. Built and sent via raw provider.send() calls
  // throughout (never ethers' high-level sendTransaction/wait/getBlock): once a block
  // contains our frame transactions, ethers' automatic block-formatting machinery (used
  // internally by those convenience methods) chokes trying to parse them as legacy/EIP-1559
  // shaped transactions.
  if (sandwich) {
    const rateBefore = await readRate(relay.address);
    const sandwichedRate = rateBefore / 2n;

    // "latest", not "pending" -- see hegotaMinOutput.ts's sandwichRate for why.
    const setRateNonce = await provider.send("eth_getTransactionCount", [relay.address, "latest"]);
    const setRateBlock = await provider.send("eth_getBlockByNumber", ["latest", false]);
    const setRateBaseFee = BigInt(setRateBlock.baseFeePerGas ?? "0x0");
    // See hegotaWallet.ts's lowFeeOverrides comment: Hegotá's fee-suggestion RPCs return a
    // flat ~1 gwei unrelated to the real live base fee (~7 wei observed); bidding that would
    // drain the relay key's low, non-renewable balance ~1,000,000x faster than necessary.
    const setRateTx = await relay.signTransaction({
      type: 2,
      chainId: CHAIN_ID,
      nonce: parseInt(setRateNonce, 16),
      to: MOCK_SWAP,
      data: swapIface.encodeFunctionData("setRate", [relay.address, sandwichedRate]),
      // A cold write to _rateOverride[recipient] measures ~124,899 gas on Hegotá under
      // EIP-8037 state-gas repricing. 60_000 silently ran out of gas, so the rate never
      // moved, no sandwich happened, and the assertion correctly did not fire -- which
      // read as "the demo is broken". Matches hegotaMinOutput.ts's sandwichRate.
      gasLimit: 200_000n,
      maxPriorityFeePerGas: 1_000n,
      maxFeePerGas: setRateBaseFee * 4n + 1_000n,
    });
    const setRateHash = await provider.send("eth_sendRawTransaction", [setRateTx]);
    for (let i = 0; i < 20; i++) {
      const receipt = await provider.send("eth_getTransactionReceipt", [setRateHash]);
      // Check the status: a reverted setRate used to look like a confirmed one here, so
      // the run reported a sandwich it had not actually performed.
      if (receipt) {
        if (receipt.status !== "0x1") {
          throw new Error(`setRate ${setRateHash} reverted (status ${receipt.status})`);
        }
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    console.log(`sandwiched: rate moved from ${rateBefore} to ${sandwichedRate}`);
  }

  // 4. Encode the DEFAULT frame (the swap) and the POST_TX frame (the assertion).
  const swapData = getBytes(swapIface.encodeFunctionData("swap", [relay.address, amountIn, relay.address]));
  const assertionData = getBytes(
    assertionIface.encodeFunctionData("assertMinOutput", [OUT_TOKEN, relay.address, constraint]),
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
        // ~198k measured on Hegotá under EIP-8037 state-gas repricing; 150_000 halted
        // this frame out-of-gas. Mirrors hegotaMinOutput.ts's defaultFrame limit.
        new Frame(FrameMode.DEFAULT, 0, MOCK_SWAP, 300_000, 0, swapData),
        new Frame(FrameMode.POST_TX, 0, MIN_OUTPUT_ASSERTION, 200_000, 0, assertionData),
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
  const amountIn = 100n * 10n ** 18n;

  const passed = await runScenario("passing case (no manipulation)", amountIn, false);
  if (passed !== true) throw new Error("Expected the passing case to mine successfully");

  const reverted = await runScenario("sandwich case (rate halved after commit)", amountIn, true);
  if (reverted !== false) throw new Error("Expected the sandwiched case to mine with a reverted (status=0x0) receipt");

  console.log("\nMinOutputAssertion simulate->commit->enforce pipeline verified.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
