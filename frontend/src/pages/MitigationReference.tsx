import { useState } from "react";
import {
  Box, Typography, Stack, Chip, Tabs, Tab,
} from "@mui/material";
import GavelIcon from "@mui/icons-material/Gavel";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import ExtensionIcon from "@mui/icons-material/Extension";
import LinkIcon from "@mui/icons-material/Link";
import DocLinkCard from "../components/DocLinkCard.js";
import PageContainer from "../components/layout/PageContainer.js";
import Section from "../components/layout/Section.js";
import { FRAMEWORK_COLORS } from "../constants/frameworkColors.js";

const CODE_BLOCK_SX = {
  p: 2,
  bgcolor: "background.elevated",
  borderRadius: 1,
  border: "1px solid",
  borderColor: "divider",
  fontSize: 12,
  lineHeight: 1.6,
  overflowX: "auto",
  whiteSpace: "pre",
  color: "text.primary",
  m: 0,
} as const;

const FLOW_STEP_NUMBER_SX = {
  minWidth: 24, height: 24, borderRadius: "50%",
  bgcolor: "primary.main", color: "primary.contrastText",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 11, fontWeight: 700, flexShrink: 0, mt: "1px",
} as const;

const ENFORCER_INTERFACE_SOURCE = `// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity 0.8.23;

import { ModeCode } from "../utils/Types.sol";

interface ICaveatEnforcer {
    // Called once before any execution in a batch redemption begins.
    function beforeAllHook(
        bytes calldata _terms,       // policy params set by delegator
        bytes calldata _args,        // optional args set by redeemer at call time
        ModeCode _mode,              // ERC-7579 execution mode (bytes32)
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) external;

    // Called before each individual execution within the batch.
    function beforeHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) external;

    // Called after each individual execution — primary hook for TXTRACE assertions.
    function afterHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) external;

    // Called once after all executions in a batch redemption complete.
    function afterAllHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) external;
}`;

const ENFORCER_FLOW_STEPS = [
  { label: "Redeemer calls DelegationManager.redeemDelegation(delegations, …)" },
  { label: "DelegationManager iterates the caveat array; calls enforcer.beforeHook() for each caveat" },
  { label: "DelegationManager forwards the actual execution to the account" },
  { label: "EVM records all side-effects in the transaction trace (TXTRACE is now populated)" },
  { label: "DelegationManager calls enforcer.afterHook() — here the enforcer queries TXTRACE via the oracle" },
  { label: "If the policy is violated, afterHook reverts, rolling back the entire transaction" },
];

function EnforcerTab() {
  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5 }}>
        <GavelIcon color="primary" fontSize="large" />
        <Typography variant="h4">MetaMask delegation enforcer</Typography>
      </Stack>
      <Chip label="ERC-7710" size="small" color="primary" variant="outlined" sx={{ mb: 3 }} />

      <Section title="What it is">
        <Typography variant="body2" color="text.secondary">
          The MetaMask Delegation Framework (ERC-7710) lets an account owner grant a <em>delegate</em> a
          constrained authority to act on their behalf. Each delegation can carry a list of <strong>caveats</strong>:
          (enforcer address, terms, args) triples that gate what the delegate may do.
          An <strong>enforcer</strong> is a stateless policy contract that implements{" "}
          <code>ICaveatEnforcer</code> and is called by the DelegationManager before and after every
          delegated execution.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          Policy parameters (<code>_terms</code>) are encoded by the delegator at delegation-creation
          time and are immutable. Dynamic inputs (<code>_args</code>) can be supplied by the redeemer at
          call time. The combination enables fine-grained, composable access control without deploying
          a new contract per rule.
        </Typography>
      </Section>

      <Section title="Documentation">
        <Stack spacing={1.5}>
          <DocLinkCard
            title="MetaMask Delegation Toolkit"
            description="Official docs for ERC-7710 delegated authority. Covers the DelegationManager, caveat enforcer interface, delegation signing flow, and how to build custom enforcers."
            url="https://docs.metamask.io/delegation-toolkit/"
            accent={FRAMEWORK_COLORS.metamask}
            tag="ERC-7710"
          />
          <DocLinkCard
            title="EIP-7710 — Wallet-Scoped Delegation"
            description="The Ethereum Improvement Proposal that formalises the delegation framework. Defines the typed-data structure, DelegationManager interface, and the caveat enforcer call convention."
            url="https://eips.ethereum.org/EIPS/eip-7710"
            accent={FRAMEWORK_COLORS.metamask}
            tag="EIP"
          />
        </Stack>
      </Section>

      <Section title="Execution flow">
        <Stack spacing={1.25}>
          {ENFORCER_FLOW_STEPS.map((step, i) => (
            <Stack key={i} direction="row" spacing={1.5} alignItems="flex-start">
              <Box sx={FLOW_STEP_NUMBER_SX}>{i + 1}</Box>
              <Typography variant="body2" color="text.secondary">{step.label}</Typography>
            </Stack>
          ))}
        </Stack>
      </Section>

      <Section title="Interface" icon={<LinkIcon sx={{ fontSize: 18, color: "text.secondary" }} />}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Source:{" "}
          <code>lib/delegation-framework/src/interfaces/ICaveatEnforcer.sol</code>
        </Typography>
        <Box component="pre" sx={CODE_BLOCK_SX}>
          <Typography component="span" variant="mono" sx={{ fontSize: 12 }}>{ENFORCER_INTERFACE_SOURCE}</Typography>
        </Box>
      </Section>

      <Section title="Implementation notes" sx={{ mb: 0 }}>
        <Stack spacing={1} component="ul" sx={{ pl: 2, m: 0 }}>
          <Typography component="li" variant="body2" color="text.secondary">
            All four hooks must be implemented. Unused hooks should be no-ops — the interface does
            not provide default implementations.
          </Typography>
          <Typography component="li" variant="body2" color="text.secondary">
            <code>_terms</code> are ABI-encoded constructor-time parameters (e.g.{" "}
            <code>abi.encode(maxApproval)</code>). Decode them in the hook body.
          </Typography>
          <Typography component="li" variant="body2" color="text.secondary">
            Use <code>afterHook</code> for TXTRACE assertions — the trace is only complete after
            the execution has returned.
          </Typography>
          <Typography component="li" variant="body2" color="text.secondary">
            The enforcer contract must use <code>pragma solidity 0.8.23</code> (or a range that
            includes it) to match the fixed pragma in the upstream interface.
          </Typography>
        </Stack>
      </Section>
    </Box>
  );
}

const GUARD_INTERFACE_SOURCE = `// From @safe-global/safe-contracts — contracts/base/GuardManager.sol

interface Guard is IERC165 {
    // Called before the Safe executes a transaction.
    // All 11 parameters are required; policy logic typically only uses a subset.
    function checkTransaction(
        address to,
        uint256 value,
        bytes memory data,
        Enum.Operation operation,   // Call (0) or DelegateCall (1)
        uint256 safeTxGas,          // gas limit for the inner call
        uint256 baseGas,            // overhead gas (refunded to relayer)
        uint256 gasPrice,           // gas price for refund calculation
        address gasToken,           // ERC-20 for gas refund (0x0 = ETH)
        address payable refundReceiver,
        bytes memory signatures,
        address msgSender           // original msg.sender of execTransaction
    ) external;

    // Called after the Safe transaction completes.
    // success = false if the inner call reverted (Safe continues regardless).
    // This is the primary hook for TXTRACE-based assertions.
    function checkAfterExecution(bytes32 txHash, bool success) external;
}

// BaseGuard provides a default supportsInterface implementation.
// All custom guards should extend BaseGuard (not Guard directly) because
// Safe.setGuard enforces IERC165 support (revert GS300 otherwise).
abstract contract BaseGuard is Guard {
    function supportsInterface(bytes4 interfaceId)
        external pure virtual override returns (bool)
    {
        return interfaceId == type(Guard).interfaceId
            || interfaceId == type(IERC165).interfaceId;
    }
}`;

const GUARD_FLOW_STEPS = [
  { label: "Any owner calls Safe.execTransaction(to, value, data, …) and provides threshold signatures" },
  { label: "Safe validates the signatures, then calls guard.checkTransaction(…) if a guard is set" },
  { label: "Safe performs the actual call (or delegatecall) to the target" },
  { label: "EVM records all side-effects; TXTRACE is now populated for the whole transaction" },
  { label: "Safe calls guard.checkAfterExecution(txHash, success) — here the guard queries TXTRACE" },
  { label: "If the policy is violated, checkAfterExecution reverts, rolling back everything including the inner call" },
];

function GuardTab() {
  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5 }}>
        <VerifiedUserIcon color="primary" fontSize="large" />
        <Typography variant="h4">Gnosis Safe transaction guard</Typography>
      </Stack>
      <Chip label="safe-contracts v1.4.1" size="small" color="primary" variant="outlined" sx={{ mb: 3 }} />

      <Section title="What it is">
        <Typography variant="body2" color="text.secondary">
          A Gnosis Safe <strong>Transaction Guard</strong> is a policy contract installed on a Safe
          multisig via <code>Safe.setGuard(guard)</code>. Once installed, <em>every</em> transaction
          executed by the Safe runs through two guard hooks:{" "}
          <code>checkTransaction</code> (pre-flight) and{" "}
          <code>checkAfterExecution</code> (post-execution). Reverting in either hook
          rolls back the entire transaction.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          Policy parameters are typically passed as constructor arguments to the guard contract.
          This means each guard deployment enforces a fixed policy — swap the guard address on the
          Safe to change the policy.
        </Typography>
      </Section>

      <Section title="Documentation">
        <Stack spacing={1.5}>
          <DocLinkCard
            title="Safe Transaction Guards"
            description="Official Safe docs on transaction guards. Explains how to install a guard, the checkTransaction / checkAfterExecution lifecycle, and pitfalls like re-entrancy and guard removal."
            url="https://docs.safe.global/advanced/smart-account-guards"
            accent={FRAMEWORK_COLORS.safe}
            tag="safe-contracts"
          />
          <DocLinkCard
            title="Safe{Core} Protocol"
            description="The higher-level protocol layer built on top of Safe contracts. Covers module types (guards, plugins, hooks), the registry, and composability across account implementations."
            url="https://docs.safe.global/home/glossary#safe-core-protocol"
            accent={FRAMEWORK_COLORS.safe}
            tag="protocol"
          />
        </Stack>
      </Section>

      <Section title="Execution flow">
        <Stack spacing={1.25}>
          {GUARD_FLOW_STEPS.map((step, i) => (
            <Stack key={i} direction="row" spacing={1.5} alignItems="flex-start">
              <Box sx={FLOW_STEP_NUMBER_SX}>{i + 1}</Box>
              <Typography variant="body2" color="text.secondary">{step.label}</Typography>
            </Stack>
          ))}
        </Stack>
      </Section>

      <Section title="Interface" icon={<LinkIcon sx={{ fontSize: 18, color: "text.secondary" }} />}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Source: <code>node_modules/@safe-global/safe-contracts/contracts/base/GuardManager.sol</code>
        </Typography>
        <Box component="pre" sx={CODE_BLOCK_SX}>
          <Typography component="span" variant="mono" sx={{ fontSize: 12 }}>{GUARD_INTERFACE_SOURCE}</Typography>
        </Box>
      </Section>

      <Section title="Implementation notes" sx={{ mb: 0 }}>
        <Stack spacing={1} component="ul" sx={{ pl: 2, m: 0 }}>
          <Typography component="li" variant="body2" color="text.secondary">
            Extend <code>BaseGuard</code>, not <code>Guard</code> directly. Safe's{" "}
            <code>setGuard</code> calls <code>Guard(guard).supportsInterface(…)</code> and reverts
            with <code>GS300</code> if it returns false. <code>BaseGuard</code> provides this.
          </Typography>
          <Typography component="li" variant="body2" color="text.secondary">
            <code>checkTransaction</code> must accept all 11 parameters even if only a few are used.
            Mark unused params without names to suppress compiler warnings.
          </Typography>
          <Typography component="li" variant="body2" color="text.secondary">
            Use <code>checkAfterExecution</code> for TXTRACE assertions — the trace is only complete
            after the inner call has returned. <code>checkTransaction</code> sees a pre-execution world.
          </Typography>
          <Typography component="li" variant="body2" color="text.secondary">
            Import <code>Enum</code> from{" "}
            <code>@safe-global/safe-contracts/contracts/common/Enum.sol</code> for the{" "}
            <code>Enum.Operation</code> type in the <code>checkTransaction</code> signature.
          </Typography>
        </Stack>
      </Section>
    </Box>
  );
}

const ERC6900_SOURCE = `// ERC-6900 — IExecutionHookModule
// Installed on a modular account alongside a specific execution selector.

interface IExecutionHookModule {
    // Called before the execution. Returns hookData passed to postExecutionHook.
    // Policy parameters are typically ABI-encoded at the front of 'data'
    // (the hookPrefix pattern) and stripped before forwarding to the target.
    function preExecutionHook(
        uint32 entityId,        // distinguishes multiple instances of the same module
        address sender,         // original msg.sender of the account call
        uint256 value,          // ETH value forwarded
        bytes calldata data     // full calldata (hookPrefix + target calldata)
    ) external returns (bytes memory hookData);

    // Called after the execution with the hookData returned by preExecutionHook.
    // TXTRACE assertions go here — the trace is complete at this point.
    function postExecutionHook(
        uint32 entityId,
        bytes calldata hookData
    ) external;
}`;

const ERC7579_SOURCE = `// ERC-7579 — IHook (IERC7579Hook)
// Installed as a hook module on an ERC-7579 account.

interface IHook {
    // Called before the execution. Returns hookData passed to postCheck.
    // Policy parameters are typically ABI-encoded at the front of 'msgData'
    // (the hookPrefix pattern) and stripped before forwarding to the target.
    function preCheck(
        address msgSender,          // original msg.sender of the account call
        uint256 value,              // ETH value forwarded
        bytes calldata msgData      // full calldata (hookPrefix + target calldata)
    ) external returns (bytes memory hookData);

    // Called after the execution with the hookData returned by preCheck.
    // TXTRACE assertions go here — the trace is complete at this point.
    function postCheck(bytes calldata hookData) external;
}`;

const MODULE_FLOW_STEPS = [
  { label: "User operation arrives at the account; the account calls module.preCheck(msgSender, value, msgData) / preExecutionHook(…)" },
  { label: "The hook decodes policy params from the leading hookPrefix bytes of msgData and returns them as hookData" },
  { label: "The account strips the hookPrefix and forwards the remaining calldata to the target contract" },
  { label: "EVM records all side-effects; TXTRACE is now populated for the whole transaction" },
  { label: "The account calls module.postCheck(hookData) / postExecutionHook(entityId, hookData)" },
  { label: "The hook decodes policy params from hookData and queries TXTRACE via the oracle; reverts if violated" },
];

function ModuleTab() {
  return (
    <Box>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 0.5 }}>
        <ExtensionIcon color="primary" fontSize="large" />
        <Typography variant="h4">ERC-6900 / ERC-7579 hook module</Typography>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
        <Chip label="ERC-6900" size="small" color="primary" variant="outlined" />
        <Chip label="ERC-7579" size="small" color="secondary" variant="outlined" />
      </Stack>

      <Section title="What it is">
        <Typography variant="body2" color="text.secondary">
          ERC-6900 and ERC-7579 are competing (but structurally similar) standards for{" "}
          <strong>modular smart accounts</strong>. Both allow pluggable <em>hook modules</em> that
          wrap every user-operation execution: a <strong>pre-hook</strong> runs before the inner
          call and returns opaque <code>hookData</code>; a <strong>post-hook</strong> receives that
          data after the call completes.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          In this project both standards use the same <strong>hookPrefix</strong> pattern: the
          account's caller prepends ABI-encoded policy parameters to the calldata. The pre-hook
          extracts those params and returns them as <code>hookData</code>. The post-hook decodes
          them back and runs the TXTRACE assertion. This avoids the need for per-user-op storage.
        </Typography>
      </Section>

      <Section title="Documentation">
        <Chip label="ERC-6900" size="small" color="primary" variant="outlined" sx={{ mb: 2 }} />
        <Stack spacing={1.5} sx={{ mb: 2.5 }}>
          <DocLinkCard
            title="Alchemy Modular Account"
            description="Production ERC-6900 implementation by Alchemy. Covers module installation, execution hooks, entity IDs for multi-instance modules, and the full account lifecycle."
            url="https://accountkit.alchemy.com/smart-contracts/modular-account/overview"
            accent={FRAMEWORK_COLORS.erc6900}
            tag="ERC-6900"
          />
          <DocLinkCard
            title="EIP-6900 — Modular Smart Contract Accounts"
            description="The Ethereum Improvement Proposal defining the execution hook interface (preExecutionHook / postExecutionHook), module manifest, and plugin registry."
            url="https://eips.ethereum.org/EIPS/eip-6900"
            accent={FRAMEWORK_COLORS.erc6900}
            tag="EIP"
          />
        </Stack>
        <Chip label="ERC-7579" size="small" color="secondary" variant="outlined" sx={{ mb: 2 }} />
        <Stack spacing={1.5}>
          <DocLinkCard
            title="Rhinestone Module SDK"
            description="The leading ERC-7579 module toolkit. Build, test, and deploy hook modules with full compatibility across Safe, Biconomy, ZeroDev, and other ERC-7579 accounts."
            url="https://docs.rhinestone.wtf/module-sdk"
            accent={FRAMEWORK_COLORS.erc7579}
            tag="ERC-7579"
          />
          <DocLinkCard
            title="EIP-7579 — Minimal Modular Smart Accounts"
            description="The Ethereum Improvement Proposal defining the IHook interface (preCheck / postCheck), module type identifiers, and the module installation standard."
            url="https://eips.ethereum.org/EIPS/eip-7579"
            accent={FRAMEWORK_COLORS.erc7579}
            tag="EIP"
          />
        </Stack>
      </Section>

      <Section title="Execution flow">
        <Stack spacing={1.25}>
          {MODULE_FLOW_STEPS.map((step, i) => (
            <Stack key={i} direction="row" spacing={1.5} alignItems="flex-start">
              <Box sx={FLOW_STEP_NUMBER_SX}>{i + 1}</Box>
              <Typography variant="body2" color="text.secondary">{step.label}</Typography>
            </Stack>
          ))}
        </Stack>
      </Section>

      <Section title="ERC-6900 interface" icon={<LinkIcon sx={{ fontSize: 18, color: "text.secondary" }} />}>
        <Chip label="ERC-6900" size="small" color="primary" variant="outlined" sx={{ mb: 1.5 }} />
        <Box component="pre" sx={CODE_BLOCK_SX}>
          <Typography component="span" variant="mono" sx={{ fontSize: 12 }}>{ERC6900_SOURCE}</Typography>
        </Box>
      </Section>

      <Section title="ERC-7579 interface" icon={<LinkIcon sx={{ fontSize: 18, color: "text.secondary" }} />} sx={{ mb: 0 }}>
        <Chip label="ERC-7579" size="small" color="secondary" variant="outlined" sx={{ mb: 1.5 }} />
        <Box component="pre" sx={CODE_BLOCK_SX}>
          <Typography component="span" variant="mono" sx={{ fontSize: 12 }}>{ERC7579_SOURCE}</Typography>
        </Box>
      </Section>
    </Box>
  );
}

const TABS = [
  { primary: "MetaMask", secondary: "Caveat Enforcer", render: () => <EnforcerTab /> },
  { primary: "Safe{Wallet}", secondary: "Safe Guards", render: () => <GuardTab /> },
  { primary: "ERC-6900/ERC-7579", secondary: "Account Modules", render: () => <ModuleTab /> },
];

export default function MitigationReference() {
  const [tab, setTab] = useState(0);

  return (
    <PageContainer maxWidth="wide">
      <Typography variant="h4" gutterBottom>
        Existing frameworks reference
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        How each of the three ordinary-transaction frameworks in this project wires a TXTRACE-based
        policy contract into its own execution lifecycle.
      </Typography>

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 3, borderBottom: 1, borderColor: "divider" }}
      >
        {TABS.map((t) => (
          <Tab
            key={t.primary}
            label={
              <Box sx={{ textAlign: "center", lineHeight: 1.3 }}>
                <Typography component="div" variant="body2" fontWeight={600}>{t.primary}</Typography>
                <Typography component="div" variant="caption" color="text.secondary">{t.secondary}</Typography>
              </Box>
            }
            sx={{ textTransform: "none" }}
          />
        ))}
      </Tabs>

      {TABS.map((t, i) => (
        <Box key={t.primary} hidden={tab !== i}>
          {tab === i && t.render()}
        </Box>
      ))}
    </PageContainer>
  );
}
