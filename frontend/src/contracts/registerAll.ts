import { registerAddress, registerByName } from "./addressRegistry.js";
import { ADDRESSES } from "./addresses.js";
import sources from "./contractSources.js";

function reg(addr: string, name: string, sourceKey?: string, description?: string) {
  if (!addr) return;
  registerAddress(addr, { name, source: sourceKey ? sources[sourceKey] : undefined, description });
}

function safe(addr: string, label: string) {
  if (!addr) return;
  registerAddress(addr, { name: `Gnosis Safe (${label})`, description: "Real Gnosis Safe proxy deployed via SafeProxyFactory. Owners controlled by DemoExecutor; SudoModule lets any visitor claim and reset ownership." });
}

export function registerAllAddresses() {
  // No deployed address — inlined into every policy contract at compile time.
  registerByName("EIP7906ExtendedLibrary", {
    name: "EIP7906ExtendedLibrary",
    source: sources["EIP7906ExtendedLibrary"],
    description: "Internal Solidity library — not deployed as a standalone contract.\nAll functions are `internal view`; the Solidity compiler inlines them into every policy contract that imports this library.\n\nContains: checkNoUnlimitedApproval, checkMinOutput, checkExactBeneficiary, checkSlotProtection, plus the shared APPROVAL_TOPIC and ERC20_TRANSFER_TOPIC constants.",
  });

  reg(ADDRESSES.sudoModule,          "SudoModule",                        "SudoModule");
  reg(ADDRESSES.delegationManager,   "MetaMask DelegationManager (real)", "DeployableDelegationManager");
  reg(ADDRESSES.hybridDelegator,     "HybridDeleGator (shared proxy)",    "DeployableHybridDeleGator", "MetaMask HybridDeleGator UUPS proxy. Shared delegator for all MM scenarios; initialized with deployer as ECDSA owner.");
  reg(ADDRESSES.testSubject,         "TestSubject (shared)",              "TestSubject",               "Stateless action contract shared across HED, MEV, OM and PS scenarios.");
  reg(ADDRESSES.modularAccount,      "MockModularAccount (shared)",       "MockModularAccount",        "Shared ERC-6900 mock account used across all scenarios.");
  reg(ADDRESSES.erc7579Account,      "MockERC7579Account (shared)",       "MockERC7579Account",        "Shared ERC-7579 mock account used across all scenarios.");

  reg(ADDRESSES.slotProtectionEnforcer, "SlotProtectionEnforcer (shared)", "SlotProtectionEnforcer");
  reg(ADDRESSES.slotProtectionHook6900, "SlotProtectionHook (6900, shared)", "SlotProtectionHook6900");
  reg(ADDRESSES.slotProtectionHook7579, "SlotProtectionHook (7579, shared)", "SlotProtectionHook7579");
  reg(ADDRESSES.minOutputEnforcer,      "MinOutputEnforcer (shared)",        "MinOutputEnforcer");
  reg(ADDRESSES.minOutputHook6900,      "MinOutputHook (6900, shared)",      "MinOutputHook6900");
  reg(ADDRESSES.minOutputHook7579,      "MinOutputHook (7579, shared)",      "MinOutputHook7579");

  reg(ADDRESSES.ua.token,        "MockERC20 (UA token)",            "MockERC20");
  reg(ADDRESSES.ua.enforcerMM,   "NoUnlimitedApprovalEnforcer",     "NoUnlimitedApprovalEnforcer");
  reg(ADDRESSES.ua.guardSafe,    "NoUnlimitedApprovalGuard",        "NoUnlimitedApprovalGuard");
  safe(ADDRESSES.ua.safe,        "Unlimited Approval");
  reg(ADDRESSES.ua.hook6900,     "NoUnlimitedApprovalHook (6900)",  "NoUnlimitedApprovalHook6900");
  reg(ADDRESSES.ua.hook7579,     "NoUnlimitedApprovalHook (7579)",  "NoUnlimitedApprovalHook7579");

  safe(ADDRESSES.cpt.safe,       "Control-Plane Takeover");
  reg(ADDRESSES.cpt.guardSafe,   "SafeIntegrityGuard",              "SafeIntegrityGuard");

  reg(ADDRESSES.hed.enforcerMM,  "ExactBeneficiaryEnforcer",        "ExactBeneficiaryEnforcer");
  reg(ADDRESSES.hed.guardSafe,   "ExactBeneficiaryGuard",           "ExactBeneficiaryGuard");
  safe(ADDRESSES.hed.safe,       "Hidden ETH Drain");
  reg(ADDRESSES.hed.hook6900,    "ExactBeneficiaryHook (6900)",     "ExactBeneficiaryHook6900");
  reg(ADDRESSES.hed.hook7579,    "ExactBeneficiaryHook (7579)",     "ExactBeneficiaryHook7579");

  reg(ADDRESSES.mev.token,       "MockERC20 (MEV token)",           "MockERC20");
  reg(ADDRESSES.mev.guardSafe,   "MinOutputGuard (MEV)",            "MinOutputGuard");
  safe(ADDRESSES.mev.safe,       "MEV Sandwich");

  reg(ADDRESSES.om.token,        "MockERC20 (OM token)",            "MockERC20");
  reg(ADDRESSES.om.guardSafe,    "MinOutputGuard (OM)",             "MinOutputGuard");
  safe(ADDRESSES.om.safe,        "Oracle Manipulation");

  reg(ADDRESSES.ps.proxy,        "MockProxy",                       "MockProxy");
  safe(ADDRESSES.ps.safe,        "Proxy Swap");
  reg(ADDRESSES.ps.guardSafe,    "ProxyIntegrityGuard",             "ProxyIntegrityGuard");
}
