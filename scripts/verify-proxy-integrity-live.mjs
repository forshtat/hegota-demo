#!/usr/bin/env node
// Live check for the Proxy Impl Swap POST_TX assertion: builds a real EIP-8141 frame
// transaction whose DEFAULT frame calls MockProxy and whose POST_TX frame calls
// ProxyIntegrityAssertion.assertNoImplementationChange() (no parameters -- the check is
// address-agnostic across every contract touched by the transaction). Two scenarios:
//   1. Passing case: the DEFAULT frame calls MockProxy.implementation() -- a view read that
//      never writes the EIP-1967 slot, so TXTRACE's storage-write scan finds nothing to flag;
//      all three frames succeed.
//   2. Violating case: the DEFAULT frame calls MockProxy.setImplementation(newImpl) -- this is
//      a zero-tolerance invariant (see ProxyIntegrityGuard.sol's checkAfterExecution, which
//      reverts unconditionally once a write targets the EIP-1967 slot, regardless of which
//      address was written), so ANY setImplementation call is a violation, not just one to an
//      "unexpected" address. The POST_TX frame reverts on ProxyImplementationChanged. The tx
//      still mines (nonce consumed, gas charged) but with a failure receipt -- EIP-7906's
//      partial-revert semantics, not exclusion.
//
// This script routes the DEFAULT frame directly at MockProxy as the relay/sender (mirroring
// verify-approval-cap-live.mjs's structure, which also calls its target contract directly
// rather than through the ERC-7579 smart-account/executor path).
//
// Usage: node scripts/verify-proxy-integrity-live.mjs

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
const MOCK_PROXY = readFrontendEnv("VITE_HEGOTA_MOCK_PROXY");
const PROXY_INTEGRITY_ASSERTION = readFrontendEnv("VITE_HEGOTA_PROXY_INTEGRITY_ASSERTION");

if (!RELAY_KEY) throw new Error("HEGOTA_PRIVATE_KEY not set in .env");
if (!MOCK_PROXY || !PROXY_INTEGRITY_ASSERTION) {
  throw new Error("Deploy MockProxy + ProxyIntegrityAssertion to Hegotá first (see frontend/.env)");
}

const provider = new JsonRpcProvider(RPC_URL);
const relay = new Wallet(RELAY_KEY, provider);

const proxyIface = new Interface([
  "function implementation() view returns (address)",
  "function setImplementation(address _impl)",
]);
const assertionIface = new Interface([
  "function assertNoImplementationChange() view",
]);

async function runScenario(label, { writeSlot }) {
  console.log(`\n=== ${label} ===`);

  let defaultCallData;
  if (writeSlot) {
    const newImpl = Wallet.createRandom().address;
    console.log(`setImplementation(${newImpl})`);
    defaultCallData = getBytes(proxyIface.encodeFunctionData("setImplementation", [newImpl]));
  } else {
    console.log("implementation() -- read-only, no storage write");
    defaultCallData = getBytes(proxyIface.encodeFunctionData("implementation", []));
  }
  const assertionData = getBytes(
    assertionIface.encodeFunctionData("assertNoImplementationChange", []),
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
        // Per the ApprovalCapAssertion/ExactBeneficiaryAssertion precedent, a plain call needs
        // far more gas inside a frame tx's DEFAULT frame than as an ordinary top-level
        // transaction on this devnet (measured ~105k for a single approve() vs ~8k top-level);
        // 300k leaves generous headroom above that measured figure for either MockProxy call.
        new Frame(FrameMode.DEFAULT, 0, MOCK_PROXY, 300_000, 0, defaultCallData),
        new Frame(FrameMode.POST_TX, 0, PROXY_INTEGRITY_ASSERTION, 200_000, 0, assertionData),
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
  const passed = await runScenario(
    "passing case (implementation() read, no slot write)",
    { writeSlot: false },
  );
  if (passed !== true) throw new Error("Expected the passing case to mine successfully");

  const reverted = await runScenario(
    "violating case (setImplementation writes the EIP-1967 slot)",
    { writeSlot: true },
  );
  if (reverted !== false) throw new Error("Expected the violating case to mine with a reverted (status=0x0) receipt");

  console.log("\nProxyIntegrityAssertion implementation-slot detection pipeline verified.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
