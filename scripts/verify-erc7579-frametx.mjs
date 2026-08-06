#!/usr/bin/env node
// Full Phase C integration check: a real EIP-8141 frame transaction whose DEFAULT frame
// targets PostTxExecutor.executeAction (smart-account-gated, EIP-712-signed by a
// throwaway "MetaMask stand-in" key) and whose POST_TX frame targets the already-fixed
// RequiredEventAssertion. Mirrors scripts/verify-post-tx-live.mjs's frame-tx plumbing,
// but with frame[1] going through the ERC-7579 smart account instead of TestSubject
// directly.
//
// Usage: node scripts/verify-erc7579-frametx.mjs

import "dotenv/config";
import { JsonRpcProvider, Wallet, Interface, getBytes, id as keccakId, TypedDataEncoder } from "ethers";
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
const REQUIRED_EVENT_ASSERTION = readFrontendEnv("VITE_HEGOTA_REQUIRED_EVENT_ASSERTION");
const VALIDATOR = readFrontendEnv("VITE_HEGOTA_OWNER_VALIDATOR");
const EXECUTOR = readFrontendEnv("VITE_HEGOTA_POST_TX_EXECUTOR");
const FACTORY = readFrontendEnv("VITE_HEGOTA_ERC7579_FACTORY");

const provider = new JsonRpcProvider(RPC_URL);
const relay = new Wallet(RELAY_KEY, provider);

const factoryIface = new Interface([
  "function getAddress(address validator, address executor, address owner) view returns (address)",
  "function createAccount(address validator, address executor, address owner) returns (address)",
]);
const executorIface = new Interface([
  "function nextActionHash(address account, address target, bytes callData) view returns (bytes32)",
  "function executeAction(address account, address validator, address target, bytes callData, bytes signature) returns (bytes)",
]);
const testSubjectIface = new Interface(["function emitTransfer(address to, uint256 amount)"]);
const assertionIface = new Interface(["function assertRequiredEvent(bytes32 requiredTopic0, uint256 requiredAmount)"]);
const TRANSFER_TOPIC0 = keccakId("Transfer(address,uint256)");

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
  const predicted = await provider
    .call({ to: FACTORY, data: factoryIface.encodeFunctionData("getAddress", [VALIDATOR, EXECUTOR, owner]) })
    .then((r) => factoryIface.decodeFunctionResult("getAddress", r)[0]);
  if ((await provider.getCode(predicted)) === "0x") {
    const tx = await relay.sendTransaction({
      to: FACTORY,
      data: factoryIface.encodeFunctionData("createAccount", [VALIDATOR, EXECUTOR, owner]),
    });
    await tx.wait();
    console.log(`Provisioned account ${predicted} (tx ${tx.hash})`);
  } else {
    console.log(`Account already provisioned at ${predicted}`);
  }
  return predicted;
}

async function runScenario(label, ownerWallet, account, amount) {
  const callData = getBytes(testSubjectIface.encodeFunctionData("emitTransfer", [ownerWallet.address, amount]));
  const nonceForAction = await provider
    .call({ to: EXECUTOR, data: new Interface(["function nonces(address) view returns (uint256)"]).encodeFunctionData("nonces", [account]) })
    .then((r) => new Interface(["function nonces(address) view returns (uint256)"]).decodeFunctionResult("nonces", r)[0]);

  const actionValue = { account, target: TEST_SUBJECT, callData: hex(callData), nonce: nonceForAction };
  const actionHash = TypedDataEncoder.hash(DOMAIN, TYPES, actionValue);
  const actionSignature = await ownerWallet.signTypedData(DOMAIN, TYPES, actionValue);
  const executeActionData = getBytes(
    executorIface.encodeFunctionData("executeAction", [account, VALIDATOR, TEST_SUBJECT, hex(callData), actionSignature]),
  );

  const sender = relay.address;
  const nonce = await provider.send("eth_getTransactionCount", [sender, "pending"]);
  const block = await provider.send("eth_getBlockByNumber", ["latest", false]);
  const nonceSeq = BigInt(nonce);
  const baseFee = BigInt(block.baseFeePerGas ?? "0x0");
  // See hegotaWallet.ts's lowFeeOverrides comment: Hegotá's fee-suggestion RPCs return a
  // flat ~1 gwei unrelated to the real live base fee (~7 wei observed); bidding that would
  // drain the relay key's low, non-renewable balance ~1,000,000x faster than necessary.
  const maxPriorityFee = 1_000n;
  const maxFee = baseFee * 4n + maxPriorityFee;

  const assertionData = getBytes(assertionIface.encodeFunctionData("assertRequiredEvent", [TRANSFER_TOPIC0, amount]));

  function build(sig) {
    return new FrameTx({
      chainId: CHAIN_ID, nonceKeys: [0], nonceSeq, sender,
      frames: [
        new Frame(FrameMode.VERIFY, 0x03, sender, 80_000, 0, new Uint8Array(0)),
        new Frame(FrameMode.DEFAULT, 0, EXECUTOR, 250_000, 0, executeActionData),
        new Frame(FrameMode.POST_TX, 0, REQUIRED_EVENT_ASSERTION, 200_000, 0, assertionData),
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

  console.log(`\n=== ${label} === actionHash=${actionHash}`);
  const txHash = await provider.send("eth_sendRawTransaction", [rawHex]);
  console.log(`submitted ${txHash}`);

  for (let i = 0; i < 20; i++) {
    const receipt = await provider.send("eth_getTransactionReceipt", [txHash]);
    if (receipt) {
      console.log(`MINED status=${receipt.status} frameReceipts=${JSON.stringify(receipt.frameReceipts)}`);
      return receipt.status === "0x1";
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("NO RECEIPT within poll window (unexpected -- see hegotaWallet.ts's exclusion fallback)");
  return null;
}

async function main() {
  const owner = Wallet.createRandom();
  console.log(`Owner (stand-in for MetaMask): ${owner.address}`);
  const account = await ensureAccount(owner.address);

  const passed = await runScenario("passing case (amount=100)", owner, account, 100n);
  if (passed !== true) throw new Error("Expected the passing case to mine successfully");

  console.log("\nPhase C frame-tx integration verified.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
