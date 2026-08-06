#!/usr/bin/env node
// Live smoke test for the Hegotá POST_TX-assertion demo: submits a real passing-case and
// failing-case frame transaction against the contracts deployed by deploy-hegota.mjs, and
// reports whether each one succeeded / was excluded as expected. Mirrors the logic in
// frontend/src/hegotaWallet.ts (which reads Vite env vars instead of process.env).
// Usage: node scripts/verify-post-tx-live.mjs

import "dotenv/config";
import { JsonRpcProvider, Wallet, Interface, getBytes, id as keccakId } from "ethers";
import { readFileSync } from "fs";
import { Frame, FrameMode, FrameSig, FrameTx, SigScheme, hex } from "../frontend/src/frametx.ts";

function readFrontendEnv(key) {
  const text = readFileSync(new URL("../frontend/.env", import.meta.url), "utf8");
  const m = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
}

const RPC_URL = process.env.HEGOTA_RPC_URL ?? "https://rpc1.hegota.ethrex.xyz";
const CHAIN_ID = parseInt(process.env.HEGOTA_CHAIN_ID ?? "3151908");
const PRIVATE_KEY = process.env.HEGOTA_PRIVATE_KEY;
const TEST_SUBJECT = readFrontendEnv("VITE_HEGOTA_TEST_SUBJECT");
const REQUIRED_EVENT_ASSERTION = readFrontendEnv("VITE_HEGOTA_REQUIRED_EVENT_ASSERTION");

if (!PRIVATE_KEY) throw new Error("HEGOTA_PRIVATE_KEY not set in .env");
if (!TEST_SUBJECT || !REQUIRED_EVENT_ASSERTION) throw new Error("Run `npm run deploy:hegota` first");

const TRANSFER_TOPIC0 = keccakId("Transfer(address,uint256)");
const testSubjectIface = new Interface(["function emitTransfer(address to, uint256 amount)"]);
const assertionIface = new Interface([
  "function assertRequiredEvent(bytes32 requiredTopic0, uint256 requiredAmount)",
]);

const provider = new JsonRpcProvider(RPC_URL);
const wallet = new Wallet(PRIVATE_KEY, provider);

async function runScenario(label, amount, expectedAmount) {
  const sender = wallet.address;
  const nonce = await provider.send("eth_getTransactionCount", [sender, "pending"]);
  const block = await provider.send("eth_getBlockByNumber", ["latest", false]);
  const nonceSeq = BigInt(nonce);
  const baseFee = BigInt(block.baseFeePerGas ?? "0x0");
  // See hegotaWallet.ts's lowFeeOverrides comment: Hegotá's fee-suggestion RPCs return a
  // flat ~1 gwei unrelated to the real live base fee (~7 wei observed); bidding that would
  // drain the relay key's low, non-renewable balance ~1,000,000x faster than necessary.
  const maxPriorityFee = 1_000n;
  const maxFee = baseFee * 4n + maxPriorityFee;

  const bodyData = getBytes(testSubjectIface.encodeFunctionData("emitTransfer", [sender, amount]));
  const assertionData = getBytes(
    assertionIface.encodeFunctionData("assertRequiredEvent", [TRANSFER_TOPIC0, expectedAmount]),
  );

  function build(sig) {
    return new FrameTx({
      chainId: CHAIN_ID,
      nonceKeys: [0],
      nonceSeq,
      sender,
      frames: [
        new Frame(FrameMode.VERIFY, 0x03, sender, 80_000, 0, new Uint8Array(0)),
        new Frame(FrameMode.DEFAULT, 0, TEST_SUBJECT, 100_000, 0, bodyData),
        new Frame(FrameMode.POST_TX, 0, REQUIRED_EVENT_ASSERTION, 200_000, 0, assertionData),
      ],
      signatures: [sig],
      maxPriorityFee,
      maxFee,
    });
  }

  const unsigned = build(new FrameSig(SigScheme.SECP256K1, sender, new Uint8Array(0), new Uint8Array(0)));
  const sigHashBytes = unsigned.sigHash();
  const signature = wallet.signingKey.sign(sigHashBytes);
  const sigBytes = new Uint8Array(65);
  sigBytes[0] = signature.yParity;
  sigBytes.set(getBytes(signature.r), 1);
  sigBytes.set(getBytes(signature.s), 33);

  const tx = build(new FrameSig(SigScheme.SECP256K1, sender, new Uint8Array(0), sigBytes));
  const rawHex = hex(tx.raw());

  console.log(`\n=== ${label} === amount=${amount} expected=${expectedAmount} nonceSeq=${nonceSeq}`);
  console.log(`sig_hash=${hex(sigHashBytes)}`);

  const txHash = await provider.send("eth_sendRawTransaction", [rawHex]);
  console.log(`submitted: ${txHash}`);

  for (let i = 0; i < 20; i++) {
    const receipt = await provider.send("eth_getTransactionReceipt", [txHash]);
    if (receipt) {
      console.log(`MINED: type=${receipt.type} status=${receipt.status} blockNumber=${parseInt(receipt.blockNumber, 16)}`);
      console.log(JSON.stringify(receipt.frameReceipts ?? receipt, null, 2));
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  const nonceAfter = BigInt(await provider.send("eth_getTransactionCount", [sender, "latest"]));
  console.log(
    nonceAfter > nonceSeq
      ? `WARNING: no receipt but nonce advanced (${nonceAfter}) — still mining?`
      : `EXCLUDED (unexpected): no receipt after poll window, nonce unchanged (${nonceAfter}) — a caught assertion should mine with a reverted (status=0x0) receipt, not this`,
  );
}

async function main() {
  const bal = await provider.getBalance(wallet.address);
  console.log(`Wallet: ${wallet.address}  balance=${(Number(bal) / 1e18).toFixed(4)} ETH`);
  await runScenario("passing case", 100n, 100n);
  await runScenario("failing case", 100n, 999n);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
