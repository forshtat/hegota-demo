#!/usr/bin/env node
// Validates frontend/src/frametx.ts against the golden vector from Ethrex's own
// reference encoder (origin/hegota-devnet:scripts/hegota-devnet/frametx.py).
// Usage: node scripts/verify-frametx-encoding.mjs

import { Frame, FrameSig, FrameTx, hex } from "../frontend/src/frametx.ts";

const golden = new FrameTx({
  chainId: 1,
  nonceKeys: [0],
  nonceSeq: 7,
  sender: 0xabcdn,
  frames: [
    new Frame(1, 3, null, 0x5208, 0, Uint8Array.of(0x11, 0x22)),
    new Frame(2, 0, 0x1234n, 0x9c40, 0, new Uint8Array(0)),
  ],
  signatures: [new FrameSig(1, 0xabcdn, new Uint8Array(0), new Uint8Array(65).fill(0x01))],
  maxPriorityFee: 0x3b9aca00,
  maxFee: 0x6fc23ac00,
});

const EXPECT_RLP =
  "f8ae01c1800794000000000000000000000000000000000000abcde8ca01038082520880821122dc0280940000000000000000000000000000000000001234829c408080f85cf85a0194000000000000000000000000000000000000abcd80b8410101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101010101843b9aca008506fc23ac0080c0c0";
const EXPECT_SIGHASH = "0x989e6ce4dc87b2afd5cfa6c780ff60f01fc3b40c77057cf872410145d69f715c";

const gotRlp = hex(golden.encode()).slice(2);
const gotSigHash = hex(golden.sigHash());

let ok = true;
if (gotRlp === EXPECT_RLP) {
  console.log("RLP match:      true");
} else {
  ok = false;
  console.log("RLP match:      false");
  console.log("  expected:", EXPECT_RLP);
  console.log("  got:     ", gotRlp);
}

if (gotSigHash === EXPECT_SIGHASH) {
  console.log("sig_hash match: true");
} else {
  ok = false;
  console.log("sig_hash match: false");
  console.log("  expected:", EXPECT_SIGHASH);
  console.log("  got:     ", gotSigHash);
}

if (!ok) process.exit(1);
console.log("\nframetx.ts matches the Ethrex reference golden vector.");
