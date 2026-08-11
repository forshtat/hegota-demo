#!/usr/bin/env node
// Deploys the Hegotá POST_TX-assertion demo contracts (TestSubject + RequiredEventAssertion)
// and merges VITE_HEGOTA_* keys into frontend/.env, leaving all other keys untouched.
// Usage: npm run deploy:hegota  (from project root, with HEGOTA_PRIVATE_KEY set in .env)

import "dotenv/config";
import { JsonRpcProvider, Wallet, ContractFactory, Interface } from "ethers";
import { existsSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const FRONTEND  = path.join(ROOT, "frontend");
const ARTIFACTS = path.join(ROOT, "artifacts/contracts");

const HEGOTA_BLOCK_START = "# --- Hegotá devnet (scripts/deploy-hegota.mjs) ---";
const HEGOTA_BLOCK_END   = "# --- end Hegotá devnet ---";

function die(msg) {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}

function artifact(relPath) {
  const full = path.join(ARTIFACTS, relPath);
  if (!existsSync(full)) die(`Artifact not found: ${relPath}\n  Run \`npx hardhat build\` first.`);
  return JSON.parse(readFileSync(full, "utf8"));
}

async function deploy(signer, { abi, bytecode }, args, label, nonce, fees) {
  process.stdout.write(`  ${label}... `);
  const factory  = new ContractFactory(abi, bytecode, signer);
  const contract = await factory.deploy(...args, { nonce, ...fees });
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(addr);
  return addr;
}

async function send(signer, address, abi, method, args, label, nonce, fees) {
  process.stdout.write(`  ${label}... `);
  const iface = new Interface(abi);
  const tx = await signer.sendTransaction({
    to: address,
    data: iface.encodeFunctionData(method, args),
    nonce,
    ...fees,
  });
  await tx.wait();
  console.log(`ok (${tx.hash})`);
}

async function main() {
  const rpcUrl     = process.env.HEGOTA_RPC_URL ?? "https://rpc1.hegota.ethrex.xyz";
  const chainId    = process.env.HEGOTA_CHAIN_ID ?? "3151908";
  const privateKey = process.env.HEGOTA_PRIVATE_KEY;

  if (!privateKey) {
    die(
      "HEGOTA_PRIVATE_KEY is not set.\n" +
      "  Fund an EOA via https://faucet.hegota.ethrex.xyz, then set HEGOTA_PRIVATE_KEY in .env.",
    );
  }

  console.log(`\nConnecting to ${rpcUrl}...`);
  const provider = new JsonRpcProvider(rpcUrl);
  try { await provider.getBlockNumber(); }
  catch { die(`Cannot reach Hegotá RPC at ${rpcUrl}.`); }

  const signer = new Wallet(privateKey, provider);
  const deployer = signer.address;
  let nonce = await provider.getTransactionCount(deployer, "pending");
  function n() { return nonce++; }

  const bal = await provider.getBalance(deployer);
  console.log(`Deployer: ${deployer}  balance=${(Number(bal) / 1e18).toFixed(4)} ETH`);
  if (bal === 0n) {
    die(`Deployer has no funds. Claim from https://faucet.hegota.ethrex.xyz for address ${deployer}.`);
  }

  // Hegotá's eth_gasPrice/eth_maxPriorityFeePerGas RPCs return a flat ~1 gwei that has
  // nothing to do with the actual live base fee (observed ~7 wei) -- ethers' automatic fee
  // estimation trusts that suggestion, which can overpay by ~6 orders of magnitude on a
  // multi-million-gas contract deployment. Bid a small explicit priority fee against the
  // real base fee instead (4x margin covers several blocks' worth of the 12.5%/block max
  // base-fee move before this mines).
  const block = await provider.getBlock("latest");
  const baseFee = block.baseFeePerGas ?? 0n;
  const maxPriorityFeePerGas = 1_000n;
  const fees = { maxPriorityFeePerGas, maxFeePerGas: baseFee * 4n + maxPriorityFeePerGas };
  console.log(`Fees: baseFee=${baseFee} maxFeePerGas=${fees.maxFeePerGas} maxPriorityFeePerGas=${fees.maxPriorityFeePerGas}`);

  const TestSubject             = artifact("shared/TestSubject.sol/TestSubject.json");
  const RequiredEventAssertion  = artifact("hegota/RequiredEventAssertion.sol/RequiredEventAssertion.json");
  const OwnerEcdsaValidator     = artifact("erc7579/OwnerEcdsaValidator.sol/OwnerEcdsaValidator.json");
  const PostTxExecutor          = artifact("erc7579/PostTxExecutor.sol/PostTxExecutor.json");
  const MinimalERC7579Account   = artifact("erc7579/MinimalERC7579Account.sol/MinimalERC7579Account.json");
  const MinimalERC7579AccountProxyFactory = artifact(
    "erc7579/MinimalERC7579AccountProxyFactory.sol/MinimalERC7579AccountProxyFactory.json",
  );

  console.log("\nDeploying Hegotá POST_TX-assertion demo contracts:");
  const testSubject           = await deploy(signer, TestSubject, [], "TestSubject", n(), fees);
  const requiredEventAssertion = await deploy(signer, RequiredEventAssertion, [], "RequiredEventAssertion", n(), fees);

  // MinimalERC7579Account is a shared IMPLEMENTATION (deployed once, delegatecalled by every
  // owner's own tiny CREATE2 proxy) -- see that contract's own doc comment for why: EIP-8141's
  // MAX_VERIFY_GAS budget for a self-funded `deploy+self_verify` account deployment only ever
  // affords a proxy-sized deploy, never this contract's full runtime.
  console.log("\nDeploying Phase C (ERC-7579 smart-account) demo contracts:");
  const ownerValidator = await deploy(signer, OwnerEcdsaValidator, [], "OwnerEcdsaValidator", n(), fees);
  const postTxExecutor = await deploy(signer, PostTxExecutor, [], "PostTxExecutor", n(), fees);
  const erc7579Implementation = await deploy(
    signer, MinimalERC7579Account, [ownerValidator, postTxExecutor], "MinimalERC7579Account (implementation)", n(), fees,
  );
  const erc7579Factory = await deploy(
    signer, MinimalERC7579AccountProxyFactory, [erc7579Implementation], "MinimalERC7579AccountProxyFactory", n(), fees,
  );

  const MockERC20 = artifact("shared/MockERC20.sol/MockERC20.json");
  const MockSwap = artifact("hegota/MockSwap.sol/MockSwap.json");
  const MinOutputAssertion = artifact("hegota/MinOutputAssertion.sol/MinOutputAssertion.json");
  const ApprovalCapAssertion = artifact("hegota/ApprovalCapAssertion.sol/ApprovalCapAssertion.json");
  const ExactBeneficiaryAssertion = artifact("hegota/ExactBeneficiaryAssertion.sol/ExactBeneficiaryAssertion.json");
  const MockProxy = artifact("shared/MockProxy.sol/MockProxy.json");
  const ProxyIntegrityAssertion = artifact("hegota/ProxyIntegrityAssertion.sol/ProxyIntegrityAssertion.json");

  console.log("\nDeploying MinOutput (anti-sandwich) demo contracts:");
  const SUPPLY = 1_000_000n * 10n ** 18n;
  const inToken = await deploy(signer, MockERC20, ["Shiba Inu", "SHIB", deployer, SUPPLY], "InToken", n(), fees);
  const outToken = await deploy(signer, MockERC20, ["Pepe", "PEPE", deployer, SUPPLY], "OutToken", n(), fees);
  // Rate: 1 SHIB -> 0.95 PEPE (18-decimal fixed point), a healthy quote to start from.
  const INITIAL_RATE = (95n * 10n ** 18n) / 100n;
  const mockSwap = await deploy(signer, MockSwap, [inToken, outToken, INITIAL_RATE], "MockSwap", n(), fees);
  const minOutputAssertion = await deploy(signer, MinOutputAssertion, [], "MinOutputAssertion", n(), fees);

  console.log("\nSeeding MockSwap and approving it to pull the deployer's InToken:");
  const LIQUIDITY = 500_000n * 10n ** 18n;
  await send(signer, outToken, MockERC20.abi, "transfer", [mockSwap, LIQUIDITY], "seed OutToken liquidity", n(), fees);
  await send(signer, inToken, MockERC20.abi, "approve", [mockSwap, SUPPLY], "approve MockSwap for InToken", n(), fees);

  console.log("\nDeploying Unlimited Approval demo contracts:");
  const approvalCapAssertion = await deploy(signer, ApprovalCapAssertion, [], "ApprovalCapAssertion", n(), fees);

  console.log("\nDeploying Hidden ETH Drain demo contracts:");
  const exactBeneficiaryAssertion = await deploy(signer, ExactBeneficiaryAssertion, [], "ExactBeneficiaryAssertion", n(), fees);
  // TestSubject.sendEthToTwo forwards value out of ITS OWN balance via low-level `.call`, but
  // PostTxExecutor.executeAction always forwards value=0 when routing through the ERC-7579
  // smart-account path (contracts/erc7579/PostTxExecutor.sol) -- so TestSubject needs a
  // pre-funded balance to draw from rather than relying on msg.value at call time.
  // NB: this is real ETH principal, not gas -- the fee fix above doesn't reduce it. Kept
  // small here (funded from a scarce, non-renewable balance); top up separately once more
  // Hegotá ETH is available if more than a couple of full-violation runs are needed.
  const FUND_AMOUNT = process.env.HEGOTA_TEST_SUBJECT_FUND_WEI
    ? BigInt(process.env.HEGOTA_TEST_SUBJECT_FUND_WEI)
    : 4_000_000_000_000_000n; // 0.004 ETH -- ~2 full-violation demo runs at 0.002 ETH each
  const balanceForFunding = await provider.getBalance(deployer);
  // This is real ETH principal being sent as value, not gas -- the fee fix above doesn't
  // help here. Skip (rather than aborting the whole deploy) if the deployer can't cover it
  // plus a safety margin for its own gas and the deploys still to come; fund TestSubject
  // separately later once more Hegotá ETH is available.
  if (balanceForFunding > FUND_AMOUNT * 2n) {
    process.stdout.write(`  fund TestSubject for sendEthToTwo (${Number(FUND_AMOUNT) / 1e18} ETH)... `);
    const fundTx = await signer.sendTransaction({ to: testSubject, value: FUND_AMOUNT, nonce: n(), ...fees });
    await fundTx.wait();
    console.log(`ok (${fundTx.hash})`);
  } else {
    console.log(`  SKIPPED funding TestSubject (${Number(FUND_AMOUNT) / 1e18} ETH needed, ${Number(balanceForFunding) / 1e18} ETH available) -- Hidden ETH Drain demo won't work until this is funded separately`);
    // n() deliberately not called: no tx was submitted, so the on-chain nonce didn't
    // advance -- the next deploy call must reuse this same nonce value.
  }

  console.log("\nDeploying Proxy Impl Swap demo contracts:");
  // Legitimate initial implementation -- a fresh random address standing in for "some real
  // logic contract", distinct from the malicious swap target used in the violating case.
  const legitImpl = Wallet.createRandom().address;
  const mockProxy = await deploy(signer, MockProxy, [legitImpl], "MockProxy", n(), fees);
  const proxyIntegrityAssertion = await deploy(signer, ProxyIntegrityAssertion, [], "ProxyIntegrityAssertion", n(), fees);

  // ── Merge VITE_HEGOTA_* keys into frontend/.env, preserving everything else ──

  const hegotaBlock = [
    HEGOTA_BLOCK_START,
    `VITE_HEGOTA_CHAIN_ID=${chainId}`,
    `VITE_HEGOTA_RPC_URL=${rpcUrl}`,
    `VITE_HEGOTA_TEST_SUBJECT=${testSubject}`,
    `VITE_HEGOTA_REQUIRED_EVENT_ASSERTION=${requiredEventAssertion}`,
    `VITE_HEGOTA_OWNER_VALIDATOR=${ownerValidator}`,
    `VITE_HEGOTA_POST_TX_EXECUTOR=${postTxExecutor}`,
    `VITE_HEGOTA_ERC7579_FACTORY=${erc7579Factory}`,
    `VITE_HEGOTA_ERC7579_IMPLEMENTATION=${erc7579Implementation}`,
    `VITE_HEGOTA_IN_TOKEN=${inToken}`,
    `VITE_HEGOTA_OUT_TOKEN=${outToken}`,
    `VITE_HEGOTA_MOCK_SWAP=${mockSwap}`,
    `VITE_HEGOTA_MIN_OUTPUT_ASSERTION=${minOutputAssertion}`,
    `VITE_HEGOTA_APPROVAL_CAP_ASSERTION=${approvalCapAssertion}`,
    `VITE_HEGOTA_EXACT_BENEFICIARY_ASSERTION=${exactBeneficiaryAssertion}`,
    `VITE_HEGOTA_MOCK_PROXY=${mockProxy}`,
    `VITE_HEGOTA_PROXY_INTEGRITY_ASSERTION=${proxyIntegrityAssertion}`,
    HEGOTA_BLOCK_END,
  ].join("\n");

  const envPath = path.join(FRONTEND, ".env");
  let existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const blockRe = new RegExp(
    `${HEGOTA_BLOCK_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${HEGOTA_BLOCK_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`,
  );
  existing = existing.replace(blockRe, "");

  const merged = existing.replace(/\n*$/, "\n\n") + hegotaBlock + "\n";

  console.log(`\nWriting Hegotá section to ${envPath}`);
  writeFileSync(envPath, merged);

  // ── VITE_HEGOTA_PRIVATE_KEY is a client-bundled secret -- write it to the gitignored
  // frontend/.env.local instead of the trackable frontend/.env, preserving any other keys
  // already there (e.g. VITE_HEGOTA_FAUCET_PRIVATE_KEY, which no script manages). ──

  const localEnvPath = path.join(FRONTEND, ".env.local");
  let existingLocal = existsSync(localEnvPath) ? readFileSync(localEnvPath, "utf8") : "";
  const keyLineRe = /^VITE_HEGOTA_PRIVATE_KEY=.*$/m;
  const keyLine = `VITE_HEGOTA_PRIVATE_KEY=${privateKey}`;
  existingLocal = keyLineRe.test(existingLocal)
    ? existingLocal.replace(keyLineRe, keyLine)
    : existingLocal.replace(/\n*$/, "\n") + keyLine + "\n";

  console.log(`Writing VITE_HEGOTA_PRIVATE_KEY to ${localEnvPath}`);
  writeFileSync(localEnvPath, existingLocal);

  console.log("\nDone. Run: npm run dev, then open /post-tx-assertion\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
