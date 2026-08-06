// ?raw imports are Vite's raw-text-import feature. Keys here must match the `name`
// passed to deployContract() / registerAddress() elsewhere.

import DemoExecutorSrc                 from "@contracts/shared/DemoExecutor.sol?raw";
import SudoModuleSrc                   from "@contracts/shared/SudoModule.sol?raw";
import MockERC20Src                    from "@contracts/shared/MockERC20.sol?raw";
import MockProxySrc                    from "@contracts/shared/MockProxy.sol?raw";
import TestSubjectSrc                  from "@contracts/shared/TestSubject.sol?raw";
import TxTraceLibSrc                   from "@contracts/shared/TxTraceLib.sol?raw";
import EIP7906ExtendedLibrarySrc       from "@contracts/shared/EIP7906ExtendedLibrary.sol?raw";

import DeployableDelegationManagerSrc  from "@contracts/shared/DeployableDelegationManager.sol?raw";
import DeployableHybridDeleGatorSrc    from "@contracts/shared/DeployableHybridDeleGator.sol?raw";
import NoUnlimitedApprovalEnforcerSrc  from "@contracts/metamask-enforcers/NoUnlimitedApprovalEnforcer.sol?raw";
import ExactBeneficiaryEnforcerSrc     from "@contracts/metamask-enforcers/ExactBeneficiaryEnforcer.sol?raw";
import MinOutputEnforcerSrc            from "@contracts/metamask-enforcers/MinOutputEnforcer.sol?raw";
import SlotProtectionEnforcerSrc       from "@contracts/metamask-enforcers/SlotProtectionEnforcer.sol?raw";

import MockSafeSrc                     from "@contracts/gnosis-safe/MockSafe.sol?raw";
import SafeIntegrityGuardSrc           from "@contracts/gnosis-safe/SafeIntegrityGuard.sol?raw";
import ProxyIntegrityGuardSrc          from "@contracts/gnosis-safe/ProxyIntegrityGuard.sol?raw";
import NoUnlimitedApprovalGuardSrc     from "@contracts/gnosis-safe/NoUnlimitedApprovalGuard.sol?raw";
import ExactBeneficiaryGuardSrc        from "@contracts/gnosis-safe/ExactBeneficiaryGuard.sol?raw";
import MinOutputGuardSrc               from "@contracts/gnosis-safe/MinOutputGuard.sol?raw";
import SlotProtectionGuardSrc          from "@contracts/gnosis-safe/SlotProtectionGuard.sol?raw";

import MockModularAccountSrc           from "@contracts/erc6900/MockModularAccount.sol?raw";
import NoUnlimitedApprovalHook6900Src  from "@contracts/erc6900/NoUnlimitedApprovalHook.sol?raw";
import ExactBeneficiaryHook6900Src     from "@contracts/erc6900/ExactBeneficiaryHook.sol?raw";
import MinOutputHook6900Src            from "@contracts/erc6900/MinOutputHook.sol?raw";
import SlotProtectionHook6900Src       from "@contracts/erc6900/SlotProtectionHook.sol?raw";

import MockERC7579AccountSrc           from "@contracts/erc7579/MockERC7579Account.sol?raw";
import ExactBeneficiaryHook7579Src     from "@contracts/erc7579/ExactBeneficiaryHook.sol?raw";
import NoUnlimitedApprovalHook7579Src  from "@contracts/erc7579/NoUnlimitedApprovalHook.sol?raw";
import MinOutputHook7579Src            from "@contracts/erc7579/MinOutputHook.sol?raw";
import SlotProtectionHook7579Src       from "@contracts/erc7579/SlotProtectionHook.sol?raw";

const sources: Record<string, string> = {
  DemoExecutor:                 DemoExecutorSrc,
  SudoModule:                   SudoModuleSrc,
  MockERC20:                    MockERC20Src,
  MockProxy:                    MockProxySrc,
  TestSubject:                  TestSubjectSrc,
  TxTraceLib:                   TxTraceLibSrc,
  EIP7906ExtendedLibrary:       EIP7906ExtendedLibrarySrc,

  DeployableDelegationManager:  DeployableDelegationManagerSrc,
  DeployableHybridDeleGator:    DeployableHybridDeleGatorSrc,
  NoUnlimitedApprovalEnforcer:  NoUnlimitedApprovalEnforcerSrc,
  ExactBeneficiaryEnforcer:     ExactBeneficiaryEnforcerSrc,
  MinOutputEnforcer:            MinOutputEnforcerSrc,
  SlotProtectionEnforcer:       SlotProtectionEnforcerSrc,

  MockSafe:                     MockSafeSrc,
  SafeIntegrityGuard:           SafeIntegrityGuardSrc,
  ProxyIntegrityGuard:          ProxyIntegrityGuardSrc,
  NoUnlimitedApprovalGuard:     NoUnlimitedApprovalGuardSrc,
  ExactBeneficiaryGuard:        ExactBeneficiaryGuardSrc,
  MinOutputGuard:               MinOutputGuardSrc,
  SlotProtectionGuard:          SlotProtectionGuardSrc,

  MockModularAccount:           MockModularAccountSrc,
  NoUnlimitedApprovalHook6900:  NoUnlimitedApprovalHook6900Src,
  ExactBeneficiaryHook6900:     ExactBeneficiaryHook6900Src,
  MinOutputHook6900:            MinOutputHook6900Src,
  SlotProtectionHook6900:       SlotProtectionHook6900Src,

  MockERC7579Account:           MockERC7579AccountSrc,
  ExactBeneficiaryHook7579:     ExactBeneficiaryHook7579Src,
  NoUnlimitedApprovalHook7579:  NoUnlimitedApprovalHook7579Src,
  MinOutputHook7579:            MinOutputHook7579Src,
  SlotProtectionHook7579:       SlotProtectionHook7579Src,
};

export default sources;
