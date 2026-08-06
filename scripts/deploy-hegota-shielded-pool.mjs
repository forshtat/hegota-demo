#!/usr/bin/env node
// Deploys our forked soispoke/minimal-shielded-pool (Dispatcher-Yul + Logic-Solidity split,
// see pool-issues.md at repo root) to the Hegotá devnet, and writes VITE_HEGOTA_POOL_* into
// frontend/.env.
//
// This mirrors the pool's own tested live deploy sequence, devnet/run_live_dispatcher.sh
// (probe -> verifier -> PoseidonT3/T4 -> logic -> dispatcher), but:
//   - compiles OUR forked contracts/hegota/shielded-pool/{ShieldedPoolLogic.sol,
//     ShieldedPoolDispatcher.yul} instead of the submodule's originals (see pool-issues.md
//     for the one-line _spend()/verifyFrameApprove() shape-gate diff and why it's safe);
//   - compiles PoseidonBN254.sol / Groth16Verifier.sol / PoseidonT3.sol / PoseidonT4.sol from
//     the byte-identical copies vendored alongside the fork (not the submodule path) --
//     solc's via-IR optimizer produces ~4KB MORE runtime bytecode for ShieldedPoolLogic.sol
//     when those imports resolve outside its own directory, which is enough to push the
//     deploy past Hegotá's EIP-7825 gas cap; keeping every file co-located avoids the cliff;
//   - uses plain solc + ethers (this repo's existing Hegotá deploy scripts are all ethers-based),
//     not forge/cast/python, but pins the exact solc version (0.8.30) and per-contract optimizer
//     settings (runs=5000+viaIR for Logic/Verifier, runs=1+legacy-codegen "libsmall" for
//     PoseidonT3/T4) the pool's own contracts/foundry.toml specifies, since the Poseidon split
//     exists specifically to survive Hegotá's per-tx gas cap and re-deriving those settings
//     independently would risk silently missing that cap again.
//
// Usage: node scripts/deploy-hegota-shielded-pool.mjs   (from project root, with
// HEGOTA_RPC_URL / HEGOTA_PRIVATE_KEY set in .env -- see .env.example. The deployer needs to
// be well-funded: this deploys several multi-megagas contracts. A plain faucet claim
// (~0.001 ETH) is NOT enough; see the pool's own devnet/REVIEW.md "Finding 4" and
// HEGOTA_GAS_CAP_REPORT.md in this repo for why.)

import "dotenv/config";
import { JsonRpcProvider, Wallet } from "ethers";
import { execFileSync } from "child_process";
import { existsSync, writeFileSync, readFileSync } from "fs";
import { homedir } from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FRONTEND = path.join(ROOT, "frontend");
const POOL_DIR = path.join(ROOT, "contracts/hegota/shielded-pool");
const SUBMODULE_PROBE = path.join(ROOT, "lib/minimal-shielded-pool/devnet/EnvelopeProbe.yul");

const SOLC_VERSION = "0.8.30"; // pinned to match lib/minimal-shielded-pool/contracts/foundry.toml
const BLOCK_START = "# --- Hegotá shielded pool (scripts/deploy-hegota-shielded-pool.mjs, Stage 1) ---";
const BLOCK_END = "# --- end Hegotá shielded pool ---";

function die(msg) {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}

function solcBinary() {
  const candidates = [
    process.env.SOLC,
    path.join(homedir(), ".svm", SOLC_VERSION, `solc-${SOLC_VERSION}`),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const version = execFileSync(candidate, ["--version"], { encoding: "utf8" });
      if (version.includes(`Version: ${SOLC_VERSION}`)) return candidate;
    }
  }
  die(
    `solc ${SOLC_VERSION} not found (looked for $SOLC and ~/.svm/${SOLC_VERSION}/solc-${SOLC_VERSION}).\n` +
    `  Install it, e.g. via foundryup's bundled svm: \`cd lib/minimal-shielded-pool/contracts && forge build\` ` +
    `will fetch it automatically (foundry.toml pins solc_version = "${SOLC_VERSION}").`,
  );
}

// ---- Yul (strict-assembly) compilation, matching the pool's own probe.py/dispatcher.py flags ----

function compileYul(solc, file, optimizeRuns) {
  const out = execFileSync(
    solc,
    ["--strict-assembly", "--optimize", "--optimize-runs", String(optimizeRuns), "--bin", path.basename(file)],
    { cwd: path.dirname(file), encoding: "utf8" },
  );
  const marker = "Binary representation:\n";
  const idx = out.indexOf(marker);
  if (idx === -1) die(`could not parse solc Yul output for ${file}:\n${out}`);
  return out.slice(idx + marker.length).split("\n")[0].trim();
}

// ---- Solidity (--bin) compilation, parsing the "======= path:Name =======\nBinary:\n<hex>" blocks ----

function compileSolidity(solc, file, contractName, { optimizeRuns, viaIR, libraries = [] } = {}) {
  const args = ["--optimize", "--optimize-runs", String(optimizeRuns)];
  if (viaIR) args.push("--via-ir");
  for (const [libPath, libName, addr] of libraries) args.push("--libraries", `${libPath}:${libName}:${addr}`);
  args.push(path.relative(ROOT, file), "--bin");
  const out = execFileSync(solc, args, { cwd: ROOT, encoding: "utf8" });
  const blocks = out.split(/^=======/m).slice(1);
  for (const block of blocks) {
    const [header, ...rest] = block.split("\n");
    const name = header.replace(/=+\s*$/, "").trim(); // strip the header's trailing "======="
    if (name.endsWith(`:${contractName}`)) {
      const body = rest.join("\n");
      const marker = "Binary:\n";
      const idx = body.indexOf(marker);
      if (idx === -1) die(`could not parse solc output for ${contractName} in ${file}`);
      const hex = body.slice(idx + marker.length).split("\n")[0].trim();
      if (hex.includes("__$")) die(`${contractName} has unresolved library placeholders -- check --libraries paths`);
      return hex;
    }
  }
  die(`contract ${contractName} not found in solc output for ${file}`);
}

async function deployRaw(signer, initcodeHex, label, fees, gasLimit) {
  process.stdout.write(`  ${label}... `);
  const tx = await signer.sendTransaction({ data: "0x" + initcodeHex.replace(/^0x/, ""), gasLimit, ...fees });
  const receipt = await tx.wait();
  if (receipt.status !== 1) die(`${label} deployment reverted (tx ${tx.hash})`);
  console.log(`${receipt.contractAddress}  (gasUsed=${receipt.gasUsed})`);
  return { address: receipt.contractAddress, blockNumber: receipt.blockNumber };
}

async function main() {
  const rpcUrl = process.env.HEGOTA_RPC_URL ?? "https://rpc1.hegota.ethrex.xyz";
  const privateKey = process.env.HEGOTA_PRIVATE_KEY;
  if (!privateKey) die("HEGOTA_PRIVATE_KEY is not set. See .env.example.");

  const solc = solcBinary();
  console.log(`Using solc: ${solc}`);

  console.log(`\nConnecting to ${rpcUrl}...`);
  const provider = new JsonRpcProvider(rpcUrl);
  try { await provider.getBlockNumber(); }
  catch { die(`Cannot reach Hegotá RPC at ${rpcUrl}.`); }

  const signer = new Wallet(privateKey, provider);
  const deployer = signer.address;
  const bal = await provider.getBalance(deployer);
  console.log(`Deployer: ${deployer}  balance=${(Number(bal) / 1e18).toFixed(6)} ETH`);
  // This deployment needs on the order of tens of millions of gas across all contracts;
  // a plain faucet claim (~0.001 ETH) is not enough on this devnet (see devnet/REVIEW.md
  // "Finding 4" -- upstream hit exactly this and it manifests as transactions that are
  // admitted then silently never included, not a clean rejection).
  const MIN_RECOMMENDED = 10n ** 16n; // 0.01 ETH, well above a single faucet claim
  if (bal < MIN_RECOMMENDED) {
    die(
      `Deployer balance (${(Number(bal) / 1e18).toFixed(6)} ETH) looks too low for this deployment.\n` +
      `  This devnet's admission/builder behavior makes underfunded deploys fail silently\n` +
      `  (pending forever, no error) rather than reject cleanly -- see devnet/REVIEW.md\n` +
      `  "Finding 4" in the minimal-shielded-pool submodule. Fund ${deployer} with a\n` +
      `  genesis-prefunded or otherwise well-funded key before retrying.`,
    );
  }

  const latestBlock = await provider.getBlock("latest");
  const baseFee = latestBlock.baseFeePerGas ?? 0n;
  const maxPriorityFeePerGas = 1_000n;
  const fees = { maxPriorityFeePerGas, maxFeePerGas: baseFee * 4n + maxPriorityFeePerGas };
  console.log(`Fees: baseFee=${baseFee} maxFeePerGas=${fees.maxFeePerGas} maxPriorityFeePerGas=${fees.maxPriorityFeePerGas}`);

  console.log("\nCompiling and deploying the forked shielded pool (Dispatcher+Logic split):");

  // REUSE_PROBE / REUSE_POSEIDON_T3 / REUSE_POSEIDON_T4 skip redeploying pieces that don't
  // depend on the verifier (e.g. after regenerating the Groth16 trusted setup, only the
  // verifier + our forked Logic + our forked Dispatcher actually need to change).
  let probe = process.env.REUSE_PROBE;
  if (probe) {
    console.log(`  EnvelopeProbe (reusing)... ${probe}`);
  } else {
    const probeInit = compileYul(solc, SUBMODULE_PROBE, 200);
    probe = (await deployRaw(signer, probeInit, "EnvelopeProbe (unmodified)", fees, 500_000n)).address;
  }

  // Groth16Verifier (vendored unmodified copy; default profile: runs=5000, via-ir).
  const verifierInit = compileSolidity(solc, path.join(POOL_DIR, "Groth16Verifier.sol"), "Groth16Verifier", {
    optimizeRuns: 5000, viaIR: true,
  });
  const verifier = (await deployRaw(signer, verifierInit, "Groth16Verifier (unmodified)", fees, 6_000_000n)).address;

  // PoseidonT3 / PoseidonT4 (vendored unmodified copies; libsmall profile: runs=1, no via-ir).
  let poseidonT3 = process.env.REUSE_POSEIDON_T3;
  if (poseidonT3) {
    console.log(`  PoseidonT3 (reusing)... ${poseidonT3}`);
  } else {
    const t3Init = compileSolidity(solc, path.join(POOL_DIR, "PoseidonT3.sol"), "PoseidonT3", {
      optimizeRuns: 1, viaIR: false,
    });
    poseidonT3 = (await deployRaw(signer, t3Init, "PoseidonT3 (unmodified, libsmall)", fees, 12_500_000n)).address;
  }

  let poseidonT4 = process.env.REUSE_POSEIDON_T4;
  if (poseidonT4) {
    console.log(`  PoseidonT4 (reusing)... ${poseidonT4}`);
  } else {
    const t4Init = compileSolidity(solc, path.join(POOL_DIR, "PoseidonT4.sol"), "PoseidonT4", {
      optimizeRuns: 1, viaIR: false,
    });
    poseidonT4 = (await deployRaw(signer, t4Init, "PoseidonT4 (unmodified, libsmall)", fees, 16_000_000n)).address;
  }

  // 5. ShieldedPoolLogic (OUR FORK -- see pool-issues.md), linked against T3/T4 above.
  const logicPath = path.join(POOL_DIR, "ShieldedPoolLogic.sol");
  const logicInit = compileSolidity(solc, logicPath, "ShieldedPoolLogic", {
    optimizeRuns: 5000, viaIR: true,
    libraries: [
      [path.relative(ROOT, path.join(POOL_DIR, "PoseidonT3.sol")), "PoseidonT3", poseidonT3],
      [path.relative(ROOT, path.join(POOL_DIR, "PoseidonT4.sol")), "PoseidonT4", poseidonT4],
    ],
  });
  // constructor(address probe_, Groth16Verifier verifier_) -- append ABI-encoded args.
  const ctorArgs = probe.replace(/^0x/, "").padStart(64, "0") + verifier.replace(/^0x/, "").padStart(64, "0");
  const logic = (await deployRaw(signer, logicInit + ctorArgs, "ShieldedPoolLogic (FORKED)", fees, 12_000_000n)).address;

  // 6. ShieldedPoolDispatcher (OUR FORK -- see pool-issues.md). Deployed AT the pool's address;
  //    initcode tail = implementation (logic) address || verifier address, per dispatcher.py's
  //    initcode() convention (upstream comment: "Deploy: initcode tail = implementation address
  //    || verifier address (two 32-byte words), appended to the deployed runtime").
  const dispatcherCompiled = compileYul(solc, path.join(POOL_DIR, "ShieldedPoolDispatcher.yul"), 200);
  const dispatcherInit = dispatcherCompiled
    + logic.replace(/^0x/, "").padStart(64, "0")
    + verifier.replace(/^0x/, "").padStart(64, "0");
  const { address: pool, blockNumber: poolDeployBlock } =
    await deployRaw(signer, dispatcherInit, "ShieldedPoolDispatcher (FORKED, this is the pool)", fees, 3_000_000n);

  // Byte-exact verification, mirroring run_live_dispatcher.sh: simulate the same initcode via
  // eth_call (to: null) to get the code a fresh deployment WOULD produce, and diff against what
  // actually landed. A naive re-derivation (strip constructor via the first 0xfe byte) is unsound
  // for these objects -- a data segment trails the runtime subobject.
  const expectedPoolCode = await provider.call({ data: "0x" + dispatcherInit });
  const actualPoolCode = await provider.getCode(pool);
  if (expectedPoolCode.toLowerCase() !== actualPoolCode.toLowerCase()) {
    die(`Deployed dispatcher code does not match simulated deployment -- something is wrong.\n` +
        `  expected: ${expectedPoolCode}\n  actual:   ${actualPoolCode}`);
  }
  console.log("  dispatcher runtime verified byte-exact against a simulated deployment.");

  const sourceId = await provider.call({ to: pool, data: "0xd069aab9" }); // sourceId() selector
  console.log(`  pool(dispatcher)=${pool}  sourceId=${sourceId}  deployBlock=${poolDeployBlock}`);

  // ── Merge VITE_HEGOTA_POOL_* keys into frontend/.env, preserving everything else ──

  const block = [
    BLOCK_START,
    `VITE_HEGOTA_POOL=${pool}`,
    `VITE_HEGOTA_POOL_PROBE=${probe}`,
    `VITE_HEGOTA_POOL_VERIFIER=${verifier}`,
    `VITE_HEGOTA_POOL_POSEIDON_T3=${poseidonT3}`,
    `VITE_HEGOTA_POOL_POSEIDON_T4=${poseidonT4}`,
    `VITE_HEGOTA_POOL_LOGIC=${logic}`,
    `VITE_HEGOTA_POOL_SOURCE_ID=${sourceId}`,
    `VITE_HEGOTA_POOL_DEPLOY_BLOCK=${poolDeployBlock}`,
    BLOCK_END,
  ].join("\n");

  const envPath = path.join(FRONTEND, ".env");
  let existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const blockRe = new RegExp(
    `${BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`,
  );
  existing = existing.replace(blockRe, "");
  const merged = existing.replace(/\n*$/, "\n\n") + block + "\n";

  console.log(`\nWriting Hegotá shielded pool section to ${envPath}`);
  writeFileSync(envPath, merged);

  console.log("\nDone.");
}

main().catch((e) => { console.error(e); process.exit(1); });
