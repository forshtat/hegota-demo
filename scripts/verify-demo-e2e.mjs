#!/usr/bin/env node
// One entrypoint that answers "is the deployed demo actually working right now?".
//
// The per-scenario verify-*-live.mjs scripts each prove one attack, but nothing tied them
// together, and nothing checked the things that sit *underneath* every scenario: that the
// contracts the frontend was built against still exist, that the relay can still pay, and
// that the node still speaks the JSON-RPC dialect a browser client needs. Those are the
// failures that take the whole demo down at once, and they are invisible from any single
// scenario. Three of them had already happened silently before this script existed.
//
// Reads the same frontend/.env the deployed bundle was built from, so it checks the
// deployment that is actually live rather than a fresh local one.
//
// Usage: node scripts/verify-demo-e2e.mjs [--quick]
//   --quick  skip the per-scenario transaction submissions (preflight checks only)

import "dotenv/config";
import { JsonRpcProvider, Wallet, Interface } from "ethers";
import { readFileSync } from "fs";
import { execFileSync } from "child_process";

const RPC_URL = process.env.HEGOTA_RPC_URL ?? "https://rpc1.hegota.ethrex.xyz";
const CHAIN_ID = BigInt(process.env.HEGOTA_CHAIN_ID ?? "3151908");
const QUICK = process.argv.includes("--quick");

const provider = new JsonRpcProvider(RPC_URL);
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` -- ${detail}` : ""}`);
};

function frontendEnv() {
  const text = readFileSync(new URL("../frontend/.env", import.meta.url), "utf8");
  return Object.fromEntries(
    text
      .split("\n")
      .map((l) => l.match(/^(VITE_[A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].trim()]),
  );
}

// ---------------------------------------------------------------- preflight

async function checkChain() {
  const net = await provider.getNetwork();
  record("chain id matches the frontend build", net.chainId === CHAIN_ID, `${net.chainId}`);

  const a = await provider.getBlockNumber();
  await new Promise((r) => setTimeout(r, 14_000));
  const b = await provider.getBlockNumber();
  record("chain is producing blocks", b > a, `${a} -> ${b}`);

  const fin = await provider.send("eth_getBlockByNumber", ["finalized", false]);
  record("chain is finalizing", fin != null, fin ? `#${parseInt(fin.number, 16)}` : "no finalized block");
}

// The demo submits type-0x06 frame transactions constantly, so any block can contain one.
// A browser client parses whole blocks, and a frame transaction missing the standard
// transaction fields makes it reject the block -- taking down every scenario, not just the
// frame it could not read. That failure is intermittent (it depends on what landed nearby),
// which is exactly why it needs an explicit check rather than being left to chance.
async function checkRpcDialect() {
  const head = await provider.getBlockNumber();
  let frameBlock = null;
  for (let n = head; n > head - 500 && frameBlock === null; n--) {
    const b = await provider.send("eth_getBlockByNumber", ["0x" + n.toString(16), true]);
    if (b?.transactions?.some((t) => t.type === "0x6")) frameBlock = n;
  }

  if (frameBlock === null) {
    record("frame tx parseable by a standard client", true, "no frame tx in the last 500 blocks, skipped");
  } else {
    try {
      const parsed = await provider.getBlock(frameBlock, true);
      record("frame tx parseable by a standard client", parsed.transactions.length > 0, `block ${frameBlock}`);
    } catch (e) {
      record("frame tx parseable by a standard client", false, `block ${frameBlock}: ${e.shortMessage ?? e.message}`);
    }
  }

  // topics is optional per the JSON-RPC spec; requiring it breaks ordinary log queries.
  try {
    await provider.send("eth_getLogs", [
      { fromBlock: "0x" + Math.max(0, head - 5).toString(16), toBlock: "0x" + head.toString(16) },
    ]);
    record("eth_getLogs accepts a filter without topics", true);
  } catch (e) {
    record("eth_getLogs accepts a filter without topics", false, e.error?.message ?? e.message);
  }
}

// Every address the deployed bundle was built against must still have code. A devnet
// re-genesis wipes them all while the frontend keeps pointing at the old addresses, which
// presents to a visitor as every scenario failing for no visible reason.
async function checkContracts(env) {
  const entries = Object.entries(env).filter(
    ([k, v]) => k.startsWith("VITE_HEGOTA_") && /^0x[a-fA-F0-9]{40}$/.test(v),
  );
  const missing = [];
  for (const [k, v] of entries) {
    if ((await provider.getCode(v)) === "0x") missing.push(k);
  }
  record(
    "all Hegota contracts deployed",
    missing.length === 0,
    missing.length ? `missing: ${missing.join(", ")}` : `${entries.length} contracts`,
  );
}

// The relay key sponsors every visitor's transactions and hands each new smart account its
// starting token balance, so the demo dies for everyone at once when any of these runs out.
async function checkRelay(env) {
  const relay = new Wallet(env.VITE_HEGOTA_PRIVATE_KEY ?? process.env.HEGOTA_PRIVATE_KEY).address;
  const erc20 = new Interface([
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
  ]);
  const read = async (token, fn, args) =>
    erc20.decodeFunctionResult(fn, await provider.call({ to: token, data: erc20.encodeFunctionData(fn, args) }))[0];

  const eth = await provider.getBalance(relay);
  const block = await provider.getBlock("latest");
  // Judge funding by what it buys at the live base fee, not by a fixed ETH threshold: this
  // devnet's base fee sits at a few wei, where a balance that looks alarmingly small covers
  // millions of transactions.
  const perTx = (block.baseFeePerGas ?? 1n) * 1_000_000n;
  const txsLeft = perTx === 0n ? Infinity : eth / perTx;
  record("relay can pay for gas", txsLeft > 1000n, `${txsLeft.toLocaleString()} more 1M-gas txs`);

  const inTok = await read(env.VITE_HEGOTA_IN_TOKEN, "balanceOf", [relay]);
  record("relay can fund new accounts", inTok >= 1_000n * 10n ** 18n, `${inTok / 10n ** 18n} IN_TOKEN (1000/user)`);

  const liq = await read(env.VITE_HEGOTA_OUT_TOKEN, "balanceOf", [env.VITE_HEGOTA_MOCK_SWAP]);
  record("MockSwap has payout liquidity", liq > 0n, `${liq / 10n ** 18n} OUT_TOKEN`);
}

// ---------------------------------------------------------------- scenarios

const SCENARIOS = [
  ["frame tx encoding (golden vector)", "verify-frametx-encoding"],
  ["POST_TX assertion pipeline", "verify-post-tx-live"],
  ["unlimited token approval", "verify-approval-cap-live"],
  ["hidden ETH drain in multicall", "verify-exact-beneficiary-live"],
  ["MEV sandwich + oracle manipulation", "verify-minoutput-live"],
  ["proxy implementation swap", "verify-proxy-integrity-live"],
  ["Safe control-plane takeover", "verify-control-plane-takeover-scenario"],
  ["ERC-7579 account", "verify-erc7579-account"],
  ["ERC-7579 frame tx", "verify-erc7579-frametx"],
];

function runScenarios() {
  for (const [label, script] of SCENARIOS) {
    try {
      execFileSync("node", [new URL(`./${script}.mjs`, import.meta.url).pathname], {
        stdio: "pipe",
        timeout: 240_000,
      });
      record(label, true);
    } catch (e) {
      const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
      const line = out.split("\n").reverse().find((l) => /error|assert|expected/i.test(l)) ?? "failed";
      record(label, false, line.trim().slice(0, 120));
    }
  }
}

// ----------------------------------------------------------------- driver

const env = frontendEnv();
console.log(`\nHegota demo end-to-end check -- ${RPC_URL}\n`);
console.log("preflight:");
await checkChain();
await checkRpcDialect();
await checkContracts(env);
await checkRelay(env);

if (!QUICK) {
  console.log("\nscenarios:");
  runScenarios();
} else {
  console.log("\nscenarios: skipped (--quick)");
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(`failing: ${failed.map((f) => f.name).join(", ")}`);
  process.exit(1);
}
