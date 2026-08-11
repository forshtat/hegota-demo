#!/usr/bin/env node
// Live end-to-end check of the Demo Wallet self-funded provisioning flow: a genuine EIP-8141
// `deploy+self_verify` frame transaction whose `sender` is the ERC-7579 account's own
// predicted (not-yet-deployed) address, funded directly from the public faucet -- exactly
// what erc7579Account.ts's provisionAccount(selfPay=true) does, reimplemented here in plain
// Node so it can be run and inspected standalone. Mirrors scripts/verify-erc7579-frametx.mjs's
// frame-tx plumbing, but frame[1] (VERIFY) targets the account itself instead of an EOA, and
// frame[0] (DEFAULT) is the deploy call rather than coming after the VERIFY frame.
//
// Also exercises the Step 2 shape (bare self_verify, sender = the now-deployed account) by
// having the account mint its own IN_TOKEN and approve MockSwap in a second frame tx.
//
// Usage: node scripts/verify-erc7579-self-deploy.mjs

import "dotenv/config";
import { JsonRpcProvider, Wallet, Interface, getBytes, MaxUint256 } from "ethers";
import { readFileSync } from "fs";
import { Frame, FrameMode, FrameSig, FrameTx, SigScheme, hex } from "../frontend/src/frametx.ts";

function readFrontendEnv(key) {
  const text = readFileSync(new URL("../frontend/.env", import.meta.url), "utf8");
  const m = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  return m ? m[1].trim() : "";
}

const RPC_URL = process.env.HEGOTA_RPC_URL ?? "https://rpc1.hegota.ethrex.xyz";
const CHAIN_ID = parseInt(process.env.HEGOTA_CHAIN_ID ?? "3151908");
const VALIDATOR = readFrontendEnv("VITE_HEGOTA_OWNER_VALIDATOR");
const EXECUTOR = readFrontendEnv("VITE_HEGOTA_POST_TX_EXECUTOR");
const FACTORY = readFrontendEnv("VITE_HEGOTA_ERC7579_FACTORY");
const IN_TOKEN = readFrontendEnv("VITE_HEGOTA_IN_TOKEN");
const MOCK_SWAP = readFrontendEnv("VITE_HEGOTA_MOCK_SWAP");

const provider = new JsonRpcProvider(RPC_URL);

const factoryIface = new Interface([
  "function getAddress(address owner) view returns (address)",
  "function createAccount(address owner) returns (address)",
]);
const accountIface = new Interface(["function completeSetup()"]);
const executorIface = new Interface([
  "function nonces(address) view returns (uint256)",
  "function nextActionHash(address account, address target, bytes callData) view returns (bytes32)",
  "function executeAction(address account, address validator, address target, bytes callData, bytes signature) returns (bytes)",
]);
const tokenIface = new Interface([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
]);

const DOMAIN = { name: "Hegotá POST_TX Demo", version: "1", chainId: CHAIN_ID };
const TYPES = {
  PostTxAction: [
    { name: "account", type: "address" },
    { name: "target", type: "address" },
    { name: "callData", type: "bytes" },
    { name: "nonce", type: "uint256" },
  ],
};

// The public faucet is per-IP rate-limited and this script gets re-run many times while
// iterating -- fund test addresses from the relay key directly instead (this only needs to
// verify the frame-tx/gas mechanics, not the faucet endpoint itself, which is already proven
// separately). Real Demo Wallet users still go through the actual faucet in the app.
const relayFunder = new Wallet(process.env.HEGOTA_PRIVATE_KEY, provider);
async function claimFaucet(address) {
  const tx = await relayFunder.sendTransaction({ to: address, value: 100_000_000_000_000_000n });
  await tx.wait();
  console.log(`  funded ${address} from relay key (tx ${tx.hash})`);
}

async function waitForBalance(address) {
  for (let i = 0; i < 15; i++) {
    const bal = await provider.getBalance(address);
    if (bal > 0n) {
      console.log(`  balance ${(Number(bal) / 1e18).toFixed(4)} ETH at ${address}`);
      return bal;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`No balance detected at ${address}`);
}

async function feeOverrides() {
  const block = await provider.send("eth_getBlockByNumber", ["latest", false]);
  const baseFee = BigInt(block.baseFeePerGas ?? "0x0");
  const maxPriorityFee = 1_000n;
  return { maxPriorityFee, maxFee: baseFee * 4n + maxPriorityFee };
}

async function selfVerifyNonce(address) {
  const n = await provider.send("eth_getTransactionCount", [address, "latest"]);
  return BigInt(n);
}

async function submit(label, sender, frames, ownerWallet) {
  const { maxPriorityFee, maxFee } = await feeOverrides();
  const nonceSeq = await selfVerifyNonce(sender);

  function build(sig) {
    return new FrameTx({ chainId: CHAIN_ID, nonceKeys: [0], nonceSeq, sender, frames, signatures: [sig], maxPriorityFee, maxFee });
  }
  const unsigned = build(new FrameSig(SigScheme.SECP256K1, ownerWallet.address, new Uint8Array(0), new Uint8Array(0)));
  const sig = ownerWallet.signingKey.sign(unsigned.sigHash());
  const sigBytes = new Uint8Array(65);
  sigBytes[0] = sig.yParity;
  sigBytes.set(getBytes(sig.r), 1);
  sigBytes.set(getBytes(sig.s), 33);
  const tx = build(new FrameSig(SigScheme.SECP256K1, ownerWallet.address, new Uint8Array(0), sigBytes));
  const rawHex = hex(tx.raw());

  console.log(`\n=== ${label} === sender=${sender}`);
  const sim = await provider.send("ethrex_simulateFrameTransaction", [rawHex]);
  console.log("simulate:", JSON.stringify(sim));
  const txHash = await provider.send("eth_sendRawTransaction", [rawHex]);
  console.log(`submitted ${txHash}`);

  for (let i = 0; i < 20; i++) {
    const receipt = await provider.send("eth_getTransactionReceipt", [txHash]);
    if (receipt) {
      console.log(`MINED status=${receipt.status} payer=${receipt.payer} frameReceipts=${JSON.stringify(receipt.frameReceipts)}`);
      return receipt.status === "0x1";
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log("NO RECEIPT within poll window");
  return null;
}

async function main() {
  const owner = Wallet.createRandom();
  console.log(`Demo Wallet stand-in EOA: ${owner.address}`);

  const accountAddress = await provider
    .call({ to: FACTORY, data: factoryIface.encodeFunctionData("getAddress", [owner.address]) })
    .then((r) => factoryIface.decodeFunctionResult("getAddress", r)[0]);
  console.log(`Predicted account address: ${accountAddress}`);

  // Step 1: fund the not-yet-deployed account directly, then deploy+self_verify+completeSetup.
  console.log("\n--- Step 1: fund predicted account + deploy+self_verify+completeSetup ---");
  await claimFaucet(accountAddress);
  await waitForBalance(accountAddress);
  await new Promise((r) => setTimeout(r, 15000));

  const createData = getBytes(factoryIface.encodeFunctionData("createAccount", [owner.address]));
  const completeSetupData = getBytes(accountIface.encodeFunctionData("completeSetup", []));
  const deployOk = await submit(
    "deploy+self_verify+completeSetup",
    accountAddress,
    [
      new Frame(FrameMode.DEFAULT, 0, FACTORY, 200_000, 0, createData),
      new Frame(FrameMode.VERIFY, 0x03, accountAddress, 20_000, 0, Uint8Array.of(0x01)),
      new Frame(FrameMode.DEFAULT, 0, accountAddress, 500_000, 0, completeSetupData),
    ],
    owner,
  );
  if (deployOk !== true) throw new Error("Expected deploy+self_verify+completeSetup to mine successfully");

  const code = await provider.getCode(accountAddress);
  if (code === "0x") throw new Error("Account has no code after deploy+self_verify -- deploy frame did not install it");
  console.log(`Account (proxy) code installed (${(code.length - 2) / 2} bytes)`);

  const eoaBalanceAfterDeploy = await provider.getBalance(owner.address);
  const accountBalanceAfterDeploy = await provider.getBalance(accountAddress);
  console.log(`EOA balance after deploy: ${eoaBalanceAfterDeploy} wei (should be 0 -- it never paid)`);
  console.log(`Account balance after deploy: ${accountBalanceAfterDeploy} wei (should be < 1 ETH -- it paid its own gas)`);
  if (eoaBalanceAfterDeploy !== 0n) throw new Error("EOA balance changed -- it should never have paid anything");

  // Step 2: bare self_verify (sender = the now-deployed account) -- mint + approve.
  console.log("\n--- Step 2: bare self_verify -- account mints its own IN_TOKEN + approves MockSwap ---");
  const FUND_AMOUNT = 1_000n * 10n ** 18n;
  const mintData = getBytes(tokenIface.encodeFunctionData("mint", [accountAddress, FUND_AMOUNT]));

  const approveCalldata = tokenIface.encodeFunctionData("approve", [MOCK_SWAP, MaxUint256]);
  const actionNonce = await provider
    .call({ to: EXECUTOR, data: executorIface.encodeFunctionData("nonces", [accountAddress]) })
    .then((r) => executorIface.decodeFunctionResult("nonces", r)[0]);
  const actionValue = { account: accountAddress, target: IN_TOKEN, callData: approveCalldata, nonce: actionNonce };
  const actionSignature = await owner.signTypedData(DOMAIN, TYPES, actionValue);
  const executeData = getBytes(
    executorIface.encodeFunctionData("executeAction", [accountAddress, VALIDATOR, IN_TOKEN, approveCalldata, actionSignature]),
  );

  const fundOk = await submit(
    "bare self_verify (mint + approve)",
    accountAddress,
    [
      new Frame(FrameMode.VERIFY, 0x03, accountAddress, 200_000, 0, Uint8Array.of(0x01)),
      new Frame(FrameMode.DEFAULT, 0, IN_TOKEN, 200_000, 0, mintData),
      new Frame(FrameMode.DEFAULT, 0, EXECUTOR, 500_000, 0, executeData),
    ],
    owner,
  );
  if (fundOk !== true) throw new Error("Expected bare self_verify (mint+approve) to mine successfully");

  const balance = await provider.call({ to: IN_TOKEN, data: tokenIface.encodeFunctionData("balanceOf", [accountAddress]) })
    .then((r) => tokenIface.decodeFunctionResult("balanceOf", r)[0]);
  const allowance = await provider.call({ to: IN_TOKEN, data: tokenIface.encodeFunctionData("allowance", [accountAddress, MOCK_SWAP]) })
    .then((r) => tokenIface.decodeFunctionResult("allowance", r)[0]);
  console.log(`IN_TOKEN balance=${balance} allowance=${allowance}`);
  if (balance !== FUND_AMOUNT) throw new Error(`Expected balance ${FUND_AMOUNT}, got ${balance}`);
  if (allowance === 0n) throw new Error("Expected non-zero MockSwap allowance");

  console.log("\nSelf-funded ERC-7579 provisioning (deploy+self_verify) and fund+approve (self_verify) both verified live.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
