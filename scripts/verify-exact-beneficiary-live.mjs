#!/usr/bin/env node
// Live check for the Hidden ETH Drain POST_TX assertion: builds a real EIP-8141 frame
// transaction whose DEFAULT frame calls TestSubject.sendEthToTwo(legit, legitAmount, hidden,
// hiddenAmount) and whose POST_TX frame calls ExactBeneficiaryAssertion.assertExactBeneficiary
// (declaring `legit` as the only allowed recipient). Two scenarios:
//   1. Passing case: hiddenAmount = 0 -- only `legit`'s ETH balance rises, all three frames
//      succeed.
//   2. Violating case: hiddenAmount > 0 -- a random hidden address also gains ETH, so the
//      POST_TX frame reverts on UnexpectedRecipient. The tx still mines (nonce consumed, gas
//      charged) but with a failure receipt -- EIP-7906's partial-revert semantics, not exclusion.
//
// This script routes the DEFAULT frame directly at TestSubject as the relay/sender (mirroring
// verify-approval-cap-live.mjs's structure, which also calls its target contract directly
// rather than through the ERC-7579 smart-account/executor path) -- so `legit` here is the
// relay's own address, self-receiving the declared ETH.
//
// Usage: node scripts/verify-exact-beneficiary-live.mjs

import "dotenv/config";
import { JsonRpcProvider, Wallet, Interface, getBytes } from "ethers";
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
const TEST_SUBJECT = readFrontendEnv("VITE_HEGOTA_TEST_SUBJECT");
const EXACT_BENEFICIARY_ASSERTION = readFrontendEnv("VITE_HEGOTA_EXACT_BENEFICIARY_ASSERTION");

if (!RELAY_KEY) throw new Error("HEGOTA_PRIVATE_KEY not set in .env");
if (!TEST_SUBJECT || !EXACT_BENEFICIARY_ASSERTION) {
  throw new Error("Run `node scripts/deploy-hegota.mjs` first (and deploy ExactBeneficiaryAssertion)");
}

const provider = new JsonRpcProvider(RPC_URL);
const relay = new Wallet(RELAY_KEY, provider);

const subjectIface = new Interface([
  "function sendEthToTwo(address r1, uint256 a1, address r2, uint256 a2) payable",
]);
const assertionIface = new Interface([
  "function assertExactBeneficiary(address expectedBeneficiary) view",
]);

// Negligible ETH amounts -- TestSubject was pre-funded with 0.05 ETH by the one-off deploy
// step (scripts/deploy-hegota.mjs's Hidden ETH Drain section), enough for many runs of this
// script at 0.002 ETH per full violating run.
const LEGIT_AMOUNT = 1_000_000_000_000_000n; // 0.001 ETH
const HIDDEN_AMOUNT = 1_000_000_000_000_000n; // 0.001 ETH

async function runScenario(label, hiddenAmount) {
  const legit = relay.address; // the declared beneficiary self-receives the ETH
  const hidden = Wallet.createRandom().address;
  console.log(`\n=== ${label} ===`);
  console.log(`legit (declared): ${legit}  amount: ${LEGIT_AMOUNT}`);
  console.log(`hidden (random):  ${hidden}  amount: ${hiddenAmount}`);

  const sendData = getBytes(
    subjectIface.encodeFunctionData("sendEthToTwo", [legit, LEGIT_AMOUNT, hidden, hiddenAmount]),
  );
  const assertionData = getBytes(
    assertionIface.encodeFunctionData("assertExactBeneficiary", [legit]),
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
        // TestSubject.sendEthToTwo forwards ETH out of its OWN (pre-funded) balance via
        // low-level `.call`, so this DEFAULT frame's value stays 0 -- but per the
        // ApprovalCapAssertion precedent, a plain call needs far more gas inside a frame
        // tx's DEFAULT frame than as an ordinary top-level transaction on this devnet
        // (measured ~105k for a single approve() vs ~8k top-level); sendEthToTwo does two
        // external .call sends, so 300k leaves generous headroom above that measured figure.
        new Frame(FrameMode.DEFAULT, 0, TEST_SUBJECT, 300_000, 0, sendData),
        new Frame(FrameMode.POST_TX, 0, EXACT_BENEFICIARY_ASSERTION, 200_000, 0, assertionData),
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
  const passed = await runScenario("passing case (only declared beneficiary gains ETH)", 0n);
  if (passed !== true) throw new Error("Expected the passing case to mine successfully");

  const reverted = await runScenario("violating case (hidden second address also gains ETH)", HIDDEN_AMOUNT);
  if (reverted !== false) throw new Error("Expected the violating case to mine with a reverted (status=0x0) receipt");

  console.log("\nExactBeneficiaryAssertion hidden-ETH-drain detection pipeline verified.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
