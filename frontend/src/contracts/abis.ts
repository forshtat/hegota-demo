// The @artifacts alias resolves to ../artifacts/contracts via vite.config.ts

import SudoModuleJson from "@artifacts/shared/SudoModule.sol/SudoModule.json";
export const SudoModuleABI      = SudoModuleJson.abi;
export const SudoModuleBytecode = SudoModuleJson.bytecode;

import MockERC20Json from "@artifacts/shared/MockERC20.sol/MockERC20.json";
import MockProxyJson from "@artifacts/shared/MockProxy.sol/MockProxy.json";
import TestSubjectJson from "@artifacts/shared/TestSubject.sol/TestSubject.json";
import RequiredEventAssertionJson from "@artifacts/hegota/RequiredEventAssertion.sol/RequiredEventAssertion.json";
import OwnerEcdsaValidatorJson from "@artifacts/erc7579/OwnerEcdsaValidator.sol/OwnerEcdsaValidator.json";
import PostTxExecutorJson from "@artifacts/erc7579/PostTxExecutor.sol/PostTxExecutor.json";
import MinimalERC7579AccountProxyFactoryJson from "@artifacts/erc7579/MinimalERC7579AccountProxyFactory.sol/MinimalERC7579AccountProxyFactory.json";
import MinimalERC7579AccountJson from "@artifacts/erc7579/MinimalERC7579Account.sol/MinimalERC7579Account.json";
import MinOutputAssertionJson from "@artifacts/hegota/MinOutputAssertion.sol/MinOutputAssertion.json";
import MockSwapJson from "@artifacts/hegota/MockSwap.sol/MockSwap.json";
import ApprovalCapAssertionJson from "@artifacts/hegota/ApprovalCapAssertion.sol/ApprovalCapAssertion.json";
import ExactBeneficiaryAssertionJson from "@artifacts/hegota/ExactBeneficiaryAssertion.sol/ExactBeneficiaryAssertion.json";
import ProxyIntegrityAssertionJson from "@artifacts/hegota/ProxyIntegrityAssertion.sol/ProxyIntegrityAssertion.json";
import MaliciousSafeDelegateJson from "@artifacts/hegota/MaliciousSafeDelegate.sol/MaliciousSafeDelegate.json";
import SafeControlPlaneAssertionJson from "@artifacts/hegota/SafeControlPlaneAssertion.sol/SafeControlPlaneAssertion.json";
import BenignSafeDelegateJson from "@artifacts/hegota/BenignSafeDelegate.sol/BenignSafeDelegate.json";

import DeployableDelegationManagerJson from "@artifacts/shared/DeployableDelegationManager.sol/DeployableDelegationManager.json";
import NoUnlimitedApprovalEnforcerJson from "@artifacts/metamask-enforcers/NoUnlimitedApprovalEnforcer.sol/NoUnlimitedApprovalEnforcer.json";
import ExactBeneficiaryEnforcerJson from "@artifacts/metamask-enforcers/ExactBeneficiaryEnforcer.sol/ExactBeneficiaryEnforcer.json";
import MinOutputEnforcerJson from "@artifacts/metamask-enforcers/MinOutputEnforcer.sol/MinOutputEnforcer.json";
import SlotProtectionEnforcerJson from "@artifacts/metamask-enforcers/SlotProtectionEnforcer.sol/SlotProtectionEnforcer.json";

import MockSafeJson from "@artifacts/gnosis-safe/MockSafe.sol/MockSafe.json";
// The real Safe singleton + proxy pieces are imported from the @safe-global/safe-contracts
// package's prebuilt artifacts (the same ones scripts/demo.mjs's deploySafe() helper uses),
// not compiled by this project's own Hardhat config.
import SafeSingletonJson from "@safe-global/safe-contracts/build/artifacts/contracts/Safe.sol/Safe.json";
import SafeProxyFactoryJson from "@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json";
import SafeProxyJson from "@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxy.sol/SafeProxy.json";
import SafeIntegrityGuardJson from "@artifacts/gnosis-safe/SafeIntegrityGuard.sol/SafeIntegrityGuard.json";
import ProxyIntegrityGuardJson from "@artifacts/gnosis-safe/ProxyIntegrityGuard.sol/ProxyIntegrityGuard.json";
import NoUnlimitedApprovalGuardJson from "@artifacts/gnosis-safe/NoUnlimitedApprovalGuard.sol/NoUnlimitedApprovalGuard.json";
import ExactBeneficiaryGuardJson from "@artifacts/gnosis-safe/ExactBeneficiaryGuard.sol/ExactBeneficiaryGuard.json";
import MinOutputGuardJson from "@artifacts/gnosis-safe/MinOutputGuard.sol/MinOutputGuard.json";
import SlotProtectionGuardJson from "@artifacts/gnosis-safe/SlotProtectionGuard.sol/SlotProtectionGuard.json";

import MockModularAccountJson from "@artifacts/erc6900/MockModularAccount.sol/MockModularAccount.json";
import MinOutputHookJson from "@artifacts/erc6900/MinOutputHook.sol/MinOutputHook.json";
import NoUnlimitedApprovalHook6900Json from "@artifacts/erc6900/NoUnlimitedApprovalHook.sol/NoUnlimitedApprovalHook.json";
import ExactBeneficiaryHook6900Json from "@artifacts/erc6900/ExactBeneficiaryHook.sol/ExactBeneficiaryHook.json";
import SlotProtectionHook6900Json from "@artifacts/erc6900/SlotProtectionHook.sol/SlotProtectionHook.json";

import MockERC7579AccountJson from "@artifacts/erc7579/MockERC7579Account.sol/MockERC7579Account.json";
import ExactBeneficiaryHookJson from "@artifacts/erc7579/ExactBeneficiaryHook.sol/ExactBeneficiaryHook.json";
import NoUnlimitedApprovalHook7579Json from "@artifacts/erc7579/NoUnlimitedApprovalHook.sol/NoUnlimitedApprovalHook.json";
import MinOutputHook7579Json from "@artifacts/erc7579/MinOutputHook.sol/MinOutputHook.json";
import SlotProtectionHook7579Json from "@artifacts/erc7579/SlotProtectionHook.sol/SlotProtectionHook.json";

export const MockERC20ABI = MockERC20Json.abi;
export const MockERC20Bytecode = MockERC20Json.bytecode;

export const MockProxyABI = MockProxyJson.abi;
export const MockProxyBytecode = MockProxyJson.bytecode;

export const TestSubjectABI = TestSubjectJson.abi;
export const TestSubjectBytecode = TestSubjectJson.bytecode;

export const RequiredEventAssertionABI = RequiredEventAssertionJson.abi;

export const OwnerEcdsaValidatorABI = OwnerEcdsaValidatorJson.abi;
export const PostTxExecutorABI = PostTxExecutorJson.abi;
export const MinimalERC7579AccountProxyFactoryABI = MinimalERC7579AccountProxyFactoryJson.abi;
export const MinimalERC7579AccountABI = MinimalERC7579AccountJson.abi;

export const MinOutputAssertionABI = MinOutputAssertionJson.abi;
export const MockSwapABI = MockSwapJson.abi;
export const MockSwapBytecode = MockSwapJson.bytecode;

export const ApprovalCapAssertionABI = ApprovalCapAssertionJson.abi;

export const ExactBeneficiaryAssertionABI = ExactBeneficiaryAssertionJson.abi;

export const ProxyIntegrityAssertionABI = ProxyIntegrityAssertionJson.abi;

export const MaliciousSafeDelegateABI = MaliciousSafeDelegateJson.abi;
export const SafeControlPlaneAssertionABI = SafeControlPlaneAssertionJson.abi;
export const BenignSafeDelegateABI = BenignSafeDelegateJson.abi;

export const DelegationManagerABI = DeployableDelegationManagerJson.abi;

export const NoUnlimitedApprovalEnforcerABI = NoUnlimitedApprovalEnforcerJson.abi;
export const NoUnlimitedApprovalEnforcerBytecode = NoUnlimitedApprovalEnforcerJson.bytecode;

export const ExactBeneficiaryEnforcerABI = ExactBeneficiaryEnforcerJson.abi;
export const ExactBeneficiaryEnforcerBytecode = ExactBeneficiaryEnforcerJson.bytecode;

export const MinOutputEnforcerABI = MinOutputEnforcerJson.abi;
export const MinOutputEnforcerBytecode = MinOutputEnforcerJson.bytecode;

export const SlotProtectionEnforcerABI = SlotProtectionEnforcerJson.abi;
export const SlotProtectionEnforcerBytecode = SlotProtectionEnforcerJson.bytecode;

export const MockSafeABI = MockSafeJson.abi;
export const MockSafeBytecode = MockSafeJson.bytecode;

export const SafeIntegrityGuardABI = SafeIntegrityGuardJson.abi;
export const SafeIntegrityGuardBytecode = SafeIntegrityGuardJson.bytecode;

export const ProxyIntegrityGuardABI = ProxyIntegrityGuardJson.abi;
export const ProxyIntegrityGuardBytecode = ProxyIntegrityGuardJson.bytecode;

export const NoUnlimitedApprovalGuardABI = NoUnlimitedApprovalGuardJson.abi;
export const NoUnlimitedApprovalGuardBytecode = NoUnlimitedApprovalGuardJson.bytecode;

export const ExactBeneficiaryGuardABI = ExactBeneficiaryGuardJson.abi;
export const ExactBeneficiaryGuardBytecode = ExactBeneficiaryGuardJson.bytecode;

export const MinOutputGuardABI = MinOutputGuardJson.abi;
export const MinOutputGuardBytecode = MinOutputGuardJson.bytecode;

export const SlotProtectionGuardABI = SlotProtectionGuardJson.abi;
export const SlotProtectionGuardBytecode = SlotProtectionGuardJson.bytecode;

export const SafeSingletonABI = SafeSingletonJson.abi;
export const SafeProxyFactoryABI = SafeProxyFactoryJson.abi;
export const SafeProxyCreationCode = SafeProxyJson.bytecode;

export const MockModularAccountABI = MockModularAccountJson.abi;
export const MockModularAccountBytecode = MockModularAccountJson.bytecode;

export const MinOutputHookABI = MinOutputHookJson.abi;
export const MinOutputHookBytecode = MinOutputHookJson.bytecode;

export const NoUnlimitedApprovalHook6900ABI = NoUnlimitedApprovalHook6900Json.abi;
export const NoUnlimitedApprovalHook6900Bytecode = NoUnlimitedApprovalHook6900Json.bytecode;

export const ExactBeneficiaryHook6900ABI = ExactBeneficiaryHook6900Json.abi;
export const ExactBeneficiaryHook6900Bytecode = ExactBeneficiaryHook6900Json.bytecode;

export const SlotProtectionHook6900ABI = SlotProtectionHook6900Json.abi;
export const SlotProtectionHook6900Bytecode = SlotProtectionHook6900Json.bytecode;

export const MockERC7579AccountABI = MockERC7579AccountJson.abi;
export const MockERC7579AccountBytecode = MockERC7579AccountJson.bytecode;

export const ExactBeneficiaryHookABI = ExactBeneficiaryHookJson.abi;
export const ExactBeneficiaryHookBytecode = ExactBeneficiaryHookJson.bytecode;

export const NoUnlimitedApprovalHook7579ABI = NoUnlimitedApprovalHook7579Json.abi;
export const NoUnlimitedApprovalHook7579Bytecode = NoUnlimitedApprovalHook7579Json.bytecode;

export const MinOutputHook7579ABI = MinOutputHook7579Json.abi;
export const MinOutputHook7579Bytecode = MinOutputHook7579Json.bytecode;

export const SlotProtectionHook7579ABI = SlotProtectionHook7579Json.abi;
export const SlotProtectionHook7579Bytecode = SlotProtectionHook7579Json.bytecode;

import ShieldedPoolLogicJson from "@artifacts/hegota/shielded-pool/ShieldedPoolLogic.sol/ShieldedPoolLogic.json";
import MockSwapETHJson from "@artifacts/hegota/MockSwapETH.sol/MockSwapETH.json";
import PrivateSwapExecutorJson from "@artifacts/hegota/PrivateSwapExecutor.sol/PrivateSwapExecutor.json";
import PrivateSwapAssertionJson from "@artifacts/hegota/PrivateSwapAssertion.sol/PrivateSwapAssertion.json";

// The dispatcher's external ABI is ShieldedPoolLogic's (calls are DELEGATECALL-forwarded
// through the Yul dispatcher at the pool's own address).
export const ShieldedPoolABI = ShieldedPoolLogicJson.abi;

export const MockSwapETHABI = MockSwapETHJson.abi;
export const PrivateSwapExecutorABI = PrivateSwapExecutorJson.abi;
export const PrivateSwapAssertionABI = PrivateSwapAssertionJson.abi;
