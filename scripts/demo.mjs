#!/usr/bin/env node

import "dotenv/config";
import { JsonRpcProvider, Wallet, ContractFactory, ethers } from "ethers";
import { existsSync, writeFileSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const FRONTEND  = path.join(ROOT, "frontend");
const ARTIFACTS    = path.join(ROOT, "artifacts/contracts");
const SAFE_ARTIFACT = path.join(
  ROOT, "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/Safe.sol/Safe.json"
);
const SAFE_PROXY_FACTORY_ARTIFACT = path.join(
  ROOT, "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json"
);

function die(msg) {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}

function artifact(relPath) {
  const full = path.join(ARTIFACTS, relPath);
  if (!existsSync(full)) die(`Artifact not found: ${relPath}\n  Run \`npx hardhat build\` first.`);
  return JSON.parse(readFileSync(full, "utf8"));
}

async function deploy(signer, { abi, bytecode }, args, label, nonce) {
  process.stdout.write(`  ${label}... `);
  const factory  = new ContractFactory(abi, bytecode, signer);
  const contract = await factory.deploy(...args, { nonce });
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(addr);
  return addr;
}

// sudoModule is enabled on every deployed Safe so any demo visitor can claim and reset it.
let _safeDeployCounter = 0;
async function deploySafe(signer, SafeJson, proxyFactory, singletonAddr, demoExecutorAddr, sudoModuleAddr, label, n) {
  process.stdout.write(`  Safe (${label})... `);

  const iface = new ethers.Interface(SafeJson.abi);
  const setupData = iface.encodeFunctionData("setup", [
    [demoExecutorAddr], 1,
    ethers.ZeroAddress, "0x",
    ethers.ZeroAddress, ethers.ZeroAddress, 0, ethers.ZeroAddress,
  ]);
  const saltNonce = _safeDeployCounter++;

  const tx = await proxyFactory.createProxyWithNonce(singletonAddr, setupData, saltNonce, { nonce: n() });
  const receipt = await tx.wait();

  const proxyCreationTopic = ethers.id("ProxyCreation(address,address)");
  const log = receipt.logs.find(l => l.topics[0] === proxyCreationTopic);
  if (!log) throw new Error(`ProxyCreation event not found for Safe (${label})`);
  const addr = ethers.getAddress("0x" + log.topics[1].slice(26));
  console.log(addr);

  const DemoExecutorJson = artifact("shared/DemoExecutor.sol/DemoExecutor.json");
  const executor = new ethers.Contract(demoExecutorAddr, DemoExecutorJson.abi, signer);
  const enableData = iface.encodeFunctionData("enableModule", [sudoModuleAddr]);
  await (await executor.execute(addr, addr, 0n, enableData, { nonce: n() })).wait();

  return addr;
}

async function main() {
  const rpcUrl     = process.env.ETHREX_RPC_URL ?? "http://localhost:8545";
  const chainId    = process.env.ETHREX_CHAIN_ID ?? "1337";
  const privateKey = process.env.ETHREX_PRIVATE_KEY;

  // Preserve WalletConnect project ID, and the entire Hegotá section, from an existing
  // frontend/.env if present. This script only ever deploys the local-EthRex contracts and
  // writes their addresses; the Hegotá section further down is written by the separate
  // deploy-hegota*.mjs scripts, and previously got silently wiped by this script's
  // full-file overwrite -- carrying it forward verbatim avoids that footgun.
  let wcProjectId = "";
  let hegotaSection = "";
  const frontendEnvPath = path.join(FRONTEND, ".env");
  if (existsSync(frontendEnvPath)) {
    const existing = readFileSync(frontendEnvPath, "utf8");
    const m = existing.match(/^VITE_WALLETCONNECT_PROJECT_ID=(.+)$/m);
    if (m) wcProjectId = m[1].trim();

    // Deliberately the *first* "# --- Hegotá ..." marker, not a specific one: the three
    // deploy-hegota*.mjs scripts each append/preserve their own "# --- Hegotá ... ---" /
    // "# --- end Hegotá ... ---" block independently, and their relative order in the file
    // depends on which ran most recently -- slicing from a single hardcoded marker name
    // silently dropped whichever section happened to precede it.
    const hegotaStart = existing.search(/^# --- Hegotá/m);
    if (hegotaStart !== -1) hegotaSection = existing.slice(hegotaStart).replace(/\s+$/, "");
  }

  if (!privateKey) {
    die(
      "ETHREX_PRIVATE_KEY is not set.\n" +
      "  Copy .env.example to .env and fill in a funded private key:\n" +
      "    cp .env.example .env",
    );
  }

  console.log(`\nConnecting to ${rpcUrl}...`);
  const provider = new JsonRpcProvider(rpcUrl);
  try { await provider.getBlockNumber(); }
  catch { die(`Cannot reach EthRex at ${rpcUrl}.\n  Make sure the node is running with EIP-7906 enabled.`); }

  const signer = new Wallet(privateKey, provider);
  const deployer = signer.address;
  let nonce = await provider.getTransactionCount(deployer, "pending");
  function n() { return nonce++; }
  console.log(`Deployer: ${deployer}`);

  if (!existsSync(SAFE_ARTIFACT)) die(`Safe artifact not found at ${SAFE_ARTIFACT}`);
  const SafeJson = JSON.parse(readFileSync(SAFE_ARTIFACT, "utf8"));
  if (!existsSync(SAFE_PROXY_FACTORY_ARTIFACT)) die(`SafeProxyFactory artifact not found`);
  const SafeProxyFactoryJson = JSON.parse(readFileSync(SAFE_PROXY_FACTORY_ARTIFACT, "utf8"));

  const MockERC20                    = artifact("shared/MockERC20.sol/MockERC20.json");
  const MockProxy                    = artifact("shared/MockProxy.sol/MockProxy.json");
  const TestSubject                  = artifact("shared/TestSubject.sol/TestSubject.json");

  const DeployableDelegationManager  = artifact("shared/DeployableDelegationManager.sol/DeployableDelegationManager.json");
  const DeployableHybridDeleGator    = artifact("shared/DeployableHybridDeleGator.sol/DeployableHybridDeleGator.json");
  const DeployableERC1967Proxy       = artifact("shared/DeployableERC1967Proxy.sol/DeployableERC1967Proxy.json");
  const NoUnlimitedApprovalEnforcer  = artifact("metamask-enforcers/NoUnlimitedApprovalEnforcer.sol/NoUnlimitedApprovalEnforcer.json");
  const ExactBeneficiaryEnforcer     = artifact("metamask-enforcers/ExactBeneficiaryEnforcer.sol/ExactBeneficiaryEnforcer.json");
  const MinOutputEnforcer            = artifact("metamask-enforcers/MinOutputEnforcer.sol/MinOutputEnforcer.json");
  const SlotProtectionEnforcer       = artifact("metamask-enforcers/SlotProtectionEnforcer.sol/SlotProtectionEnforcer.json");

  const DemoExecutor                 = artifact("shared/DemoExecutor.sol/DemoExecutor.json");
  const SudoModule                   = artifact("shared/SudoModule.sol/SudoModule.json");
  const SafeIntegrityGuard           = artifact("gnosis-safe/SafeIntegrityGuard.sol/SafeIntegrityGuard.json");
  const ProxyIntegrityGuard          = artifact("gnosis-safe/ProxyIntegrityGuard.sol/ProxyIntegrityGuard.json");
  const NoUnlimitedApprovalGuard     = artifact("gnosis-safe/NoUnlimitedApprovalGuard.sol/NoUnlimitedApprovalGuard.json");
  const ExactBeneficiaryGuard        = artifact("gnosis-safe/ExactBeneficiaryGuard.sol/ExactBeneficiaryGuard.json");
  const MinOutputGuard               = artifact("gnosis-safe/MinOutputGuard.sol/MinOutputGuard.json");
  const SlotProtectionGuard          = artifact("gnosis-safe/SlotProtectionGuard.sol/SlotProtectionGuard.json");

  const MockModularAccount           = artifact("erc6900/MockModularAccount.sol/MockModularAccount.json");
  const MinOutputHook6900            = artifact("erc6900/MinOutputHook.sol/MinOutputHook.json");
  const NoUnlimitedApprovalHook6900  = artifact("erc6900/NoUnlimitedApprovalHook.sol/NoUnlimitedApprovalHook.json");
  const ExactBeneficiaryHook6900     = artifact("erc6900/ExactBeneficiaryHook.sol/ExactBeneficiaryHook.json");
  const SlotProtectionHook6900       = artifact("erc6900/SlotProtectionHook.sol/SlotProtectionHook.json");

  const MockERC7579Account           = artifact("erc7579/MockERC7579Account.sol/MockERC7579Account.json");
  const ExactBeneficiaryHook7579     = artifact("erc7579/ExactBeneficiaryHook.sol/ExactBeneficiaryHook.json");
  const NoUnlimitedApprovalHook7579  = artifact("erc7579/NoUnlimitedApprovalHook.sol/NoUnlimitedApprovalHook.json");
  const MinOutputHook7579            = artifact("erc7579/MinOutputHook.sol/MinOutputHook.json");
  const SlotProtectionHook7579       = artifact("erc7579/SlotProtectionHook.sol/SlotProtectionHook.json");

  console.log("\nDeploying Safe infrastructure:");
  const demoExecutorAddr = await deploy(signer, DemoExecutor, [], "DemoExecutor", n());
  const sudoModuleAddr   = await deploy(signer, SudoModule, [], "SudoModule", n());

  process.stdout.write("  Safe singleton... ");
  const safeFactory = new ContractFactory(SafeJson.abi, SafeJson.bytecode, signer);
  const safeSingleton = await safeFactory.deploy({ nonce: n() });
  await safeSingleton.waitForDeployment();
  const singletonAddr = await safeSingleton.getAddress();
  console.log(singletonAddr);

  process.stdout.write("  SafeProxyFactory... ");
  const proxyFactoryContract = new ContractFactory(SafeProxyFactoryJson.abi, SafeProxyFactoryJson.bytecode, signer);
  const proxyFactoryDeployed = await proxyFactoryContract.deploy({ nonce: n() });
  await proxyFactoryDeployed.waitForDeployment();
  const proxyFactoryAddr = await proxyFactoryDeployed.getAddress();
  console.log(proxyFactoryAddr);
  const proxyFactory = new ethers.Contract(proxyFactoryAddr, SafeProxyFactoryJson.abi, signer);

  console.log("\nDeploying MetaMask DelegationManager + HybridDeleGator logic:");
  const delegationManagerAddr = await deploy(signer, DeployableDelegationManager, [deployer], "DelegationManager", n());
  // Link SCL_RIP7212 library to address(0): the P256/WebAuthn signing path inside
  // HybridDeleGator falls back to this library only when the RIP-7212 precompile (0x100)
  // is absent. We exclusively use ECDSA (65-byte) signatures in this demo, so the P256
  // branch is dead code. Linking to address(0) makes it revert if ever accidentally reached.
  // EntryPoint is also stubbed to address(0) — the ERC-4337 execute() path is unused here.
  const linkedHybridBytecode = DeployableHybridDeleGator.bytecode.replace(
    /__\$8de657ea5212223e96dde66545bd2388cf\$__/g,
    "0000000000000000000000000000000000000000",
  );
  const hybridLogicAddr = await deploy(
    signer,
    { abi: DeployableHybridDeleGator.abi, bytecode: linkedHybridBytecode },
    [delegationManagerAddr, ethers.ZeroAddress],
    "HybridDeleGator logic",
    n(),
  );

  console.log("\nDeploying shared contracts (reused across scenarios):");

  const hybridIface    = new ethers.Interface(DeployableHybridDeleGator.abi);
  const hybridInitData = hybridIface.encodeFunctionData("initialize", [deployer, [], [], []]);
  const hybridDelegator = await deploy(signer, DeployableERC1967Proxy, [hybridLogicAddr, hybridInitData], "HybridDeleGator proxy (shared)", n());

  const testSubject    = await deploy(signer, TestSubject,        [], "TestSubject (shared)", n());
  const modularAccount = await deploy(signer, MockModularAccount, [], "MockModularAccount (shared)", n());
  const erc7579Account = await deploy(signer, MockERC7579Account, [], "MockERC7579Account (shared)", n());

  const slotProtectionEnforcer = await deploy(signer, SlotProtectionEnforcer, [], "SlotProtectionEnforcer (shared)", n());
  const slotProtectionHook6900 = await deploy(signer, SlotProtectionHook6900, [], "SlotProtectionHook6900 (shared)", n());
  const slotProtectionHook7579 = await deploy(signer, SlotProtectionHook7579, [], "SlotProtectionHook7579 (shared)", n());

  const minOutputEnforcer = await deploy(signer, MinOutputEnforcer, [], "MinOutputEnforcer (shared)", n());
  const minOutputHook6900 = await deploy(signer, MinOutputHook6900, [], "MinOutputHook6900 (shared)", n());
  const minOutputHook7579 = await deploy(signer, MinOutputHook7579, [], "MinOutputHook7579 (shared)", n());

  console.log("\nDeploying UnlimitedApproval contracts:");
  const uaToken      = await deploy(signer, MockERC20, ["TestToken", "TST", deployer, 1_000_000n], "MockERC20 (UA token)", n());
  const uaEnforcerMM = await deploy(signer, NoUnlimitedApprovalEnforcer, [], "NoUnlimitedApprovalEnforcer", n());
  const uaGuardSafe  = await deploy(signer, NoUnlimitedApprovalGuard, [1000n], "NoUnlimitedApprovalGuard", n());
  const uaSafe       = await deploySafe(signer, SafeJson, proxyFactory, singletonAddr, demoExecutorAddr, sudoModuleAddr, "UA", n);
  const uaHook6900   = await deploy(signer, NoUnlimitedApprovalHook6900, [], "NoUnlimitedApprovalHook6900", n());
  const uaHook7579   = await deploy(signer, NoUnlimitedApprovalHook7579, [], "NoUnlimitedApprovalHook7579", n());

  console.log("\nDeploying ControlPlaneTakeover contracts:");
  const cptSafe      = await deploySafe(signer, SafeJson, proxyFactory, singletonAddr, demoExecutorAddr, sudoModuleAddr, "CPT", n);
  const cptGuardSafe = await deploy(signer, SafeIntegrityGuard, [cptSafe], "SafeIntegrityGuard", n());


  console.log("\nDeploying HiddenETHDrain contracts:");
  const hedLegit     = ethers.Wallet.createRandom().address;
  console.log(`  Legit recipient (fixed): ${hedLegit}`);
  const hedEnforcerMM = await deploy(signer, ExactBeneficiaryEnforcer, [], "ExactBeneficiaryEnforcer", n());
  const hedGuardSafe  = await deploy(signer, ExactBeneficiaryGuard, [hedLegit], "ExactBeneficiaryGuard", n());
  const hedSafe       = await deploySafe(signer, SafeJson, proxyFactory, singletonAddr, demoExecutorAddr, sudoModuleAddr, "HED", n);
  const hedHook6900   = await deploy(signer, ExactBeneficiaryHook6900, [], "ExactBeneficiaryHook6900", n());
  const hedHook7579   = await deploy(signer, ExactBeneficiaryHook7579, [], "ExactBeneficiaryHook7579", n());

  console.log("\nDeploying MEVSandwich contracts:");
  const mevToken     = await deploy(signer, MockERC20, ["OutToken", "OUT", testSubject, 1_000_000n], "MockERC20 (MEV token)", n());
  const mevUser      = deployer;
  const mevGuardSafe = await deploy(signer, MinOutputGuard, [mevToken, mevUser, 900n], "MinOutputGuard (MEV)", n());
  const mevSafe      = await deploySafe(signer, SafeJson, proxyFactory, singletonAddr, demoExecutorAddr, sudoModuleAddr, "MEV", n);

  console.log("\nDeploying OracleManipulation contracts:");
  const omToken     = await deploy(signer, MockERC20, ["StableOut", "SOUT", testSubject, 1_000_000n], "MockERC20 (OM token)", n());
  const omUser      = deployer;
  const omGuardSafe = await deploy(signer, MinOutputGuard, [omToken, omUser, 900n], "MinOutputGuard (OM)", n());
  const omSafe      = await deploySafe(signer, SafeJson, proxyFactory, singletonAddr, demoExecutorAddr, sudoModuleAddr, "OM", n);

  console.log("\nDeploying ProxySwap contracts:");
  const psProxy     = await deploy(signer, MockProxy, [testSubject], "MockProxy", n());
  const psSafe      = await deploySafe(signer, SafeJson, proxyFactory, singletonAddr, demoExecutorAddr, sudoModuleAddr, "PS", n);
  const psGuardSafe = await deploy(signer, ProxyIntegrityGuard, [], "ProxyIntegrityGuard", n());

  const demoWallet = "0x90F8bf6A479f320ead074411a4B0e7944Ea8c9C1";
  process.stdout.write(`\nFunding demo wallet ${demoWallet} with 10 ETH... `);
  const seedTx = await signer.sendTransaction({ to: demoWallet, value: ethers.parseEther("10"), nonce: n() });
  await seedTx.wait();
  console.log("done");

  // HybridDeleGator proxy needs ETH to forward during HED sendEthToTwo — fund with 20 ETH (10 demo runs)
  process.stdout.write(`  Funding HybridDeleGator (${hybridDelegator}) with 20 ETH... `);
  const hedFundTx = await signer.sendTransaction({ to: hybridDelegator, value: ethers.parseEther("20"), nonce: n() });
  await hedFundTx.wait();
  console.log("done");

  const lines = [
    `VITE_RPC_URL=${rpcUrl}`,
    `VITE_CHAIN_ID=${chainId}`,
    `VITE_WALLETCONNECT_PROJECT_ID=${wcProjectId}`,
    ``,
    `# Safe infrastructure`,
    `VITE_SUDO_MODULE=${sudoModuleAddr}`,
    ``,
    `# MetaMask DelegationManager (real, shared)`,
    `VITE_DELEGATION_MANAGER=${delegationManagerAddr}`,
    ``,
    `# Shared smart accounts (one instance reused across all scenarios)`,
    `VITE_HYBRID_DELEGATOR=${hybridDelegator}`,
    `VITE_TEST_SUBJECT=${testSubject}`,
    `VITE_MODULAR_ACCOUNT=${modularAccount}`,
    `VITE_ERC7579_ACCOUNT=${erc7579Account}`,
    ``,
    `# Shared enforcers / hooks`,
    `VITE_SLOT_PROTECTION_ENFORCER=${slotProtectionEnforcer}`,
    `VITE_SLOT_PROTECTION_HOOK_6900=${slotProtectionHook6900}`,
    `VITE_SLOT_PROTECTION_HOOK_7579=${slotProtectionHook7579}`,
    `VITE_MIN_OUTPUT_ENFORCER=${minOutputEnforcer}`,
    `VITE_MIN_OUTPUT_HOOK_6900=${minOutputHook6900}`,
    `VITE_MIN_OUTPUT_HOOK_7579=${minOutputHook7579}`,
    ``,
    `# Unlimited Approval`,
    `VITE_UA_TOKEN=${uaToken}`,
    `VITE_UA_ENFORCER_MM=${uaEnforcerMM}`,
    `VITE_UA_GUARD_SAFE=${uaGuardSafe}`,
    `VITE_UA_SAFE=${uaSafe}`,
    `VITE_UA_HOOK_6900=${uaHook6900}`,
    `VITE_UA_HOOK_7579=${uaHook7579}`,
    ``,
    `# Control-Plane Takeover`,
    `VITE_CPT_SAFE=${cptSafe}`,
    `VITE_CPT_GUARD_SAFE=${cptGuardSafe}`,
    ``,
    `# Hidden ETH Drain`,
    `VITE_HED_LEGIT=${hedLegit}`,
    `VITE_HED_ENFORCER_MM=${hedEnforcerMM}`,
    `VITE_HED_GUARD_SAFE=${hedGuardSafe}`,
    `VITE_HED_SAFE=${hedSafe}`,
    `VITE_HED_HOOK_6900=${hedHook6900}`,
    `VITE_HED_HOOK_7579=${hedHook7579}`,
    ``,
    `# MEV Sandwich`,
    `VITE_MEV_TOKEN=${mevToken}`,
    `VITE_MEV_USER=${mevUser}`,
    `VITE_MEV_GUARD_SAFE=${mevGuardSafe}`,
    `VITE_MEV_SAFE=${mevSafe}`,
    ``,
    `# Oracle Manipulation`,
    `VITE_OM_TOKEN=${omToken}`,
    `VITE_OM_USER=${omUser}`,
    `VITE_OM_GUARD_SAFE=${omGuardSafe}`,
    `VITE_OM_SAFE=${omSafe}`,
    ``,
    `# Proxy Swap`,
    `VITE_PS_PROXY=${psProxy}`,
    `VITE_PS_SAFE=${psSafe}`,
    `VITE_PS_GUARD_SAFE=${psGuardSafe}`,
    ``,
  ];

  const envPath = path.join(FRONTEND, ".env");
  console.log(`\nWriting ${envPath}`);
  const content = hegotaSection ? `${lines.join("\n")}\n${hegotaSection}\n` : lines.join("\n");
  writeFileSync(envPath, content);
  if (!wcProjectId) console.log(`  Note: set VITE_WALLETCONNECT_PROJECT_ID in frontend/.env (free at cloud.walletconnect.com)`);
  if (!hegotaSection) console.log(`  Note: Hegotá section not found -- run npm run deploy:hegota (and the two other deploy-hegota-*.mjs scripts) to populate it`);

  console.log("\nDone. Run: npm run dev\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
