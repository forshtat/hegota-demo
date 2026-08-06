// ProxyIntegrityAssertion.sol/ProxyIntegrityGuard.sol enforce a zero-tolerance invariant: ANY
// write to the canonical EIP-1967 implementation slot reverts, regardless of which address was
// written -- there is no "legitimate implementation address" the assertion would let through.
// So `violationToggle` here doesn't pick between a compliant and an unlimited *amount* -- it
// picks between touching the slot at all: off reads MockProxy.implementation() (a view call, no
// storage write), on performs the actual setImplementation(...) write.

import * as React from "react";
import { Stack, Box } from "@mui/material";
import { Interface, getBytes, Wallet } from "ethers";
import { Frame, FrameMode, hex } from "../frametx.js";
import { ProxyIntegrityAssertionABI, MockProxyABI } from "../contracts/abis.js";
import type { DefaultFrameCall } from "../hegotaWallet.js";
import type { HegotaWalletScenario, ScenarioExplainer } from "./types.js";
import { prepareViaErc7579Account, previewPrepareErc7579Account } from "./types.js";
import { encodeExecuteAction, HEGOTA_POST_TX_EXECUTOR } from "../erc7579Account.js";
import { fetchSelfVerifyNonce, registerCuratedRows, registerKnownInterface } from "../frameSigning.js";
import { registerInnerActionRows } from "./erc7579FrameRows.js";
import type { CuratedRow } from "../signingPreview.js";
import { shortAddr } from "../format.js";
import theme from "../theme.js";

export const HEGOTA_MOCK_PROXY = import.meta.env.VITE_HEGOTA_MOCK_PROXY ?? "";
export const HEGOTA_PROXY_INTEGRITY_ASSERTION = import.meta.env.VITE_HEGOTA_PROXY_INTEGRITY_ASSERTION ?? "";

export function isProxyIntegrityConfigured(): boolean {
  return Boolean(HEGOTA_MOCK_PROXY && HEGOTA_PROXY_INTEGRITY_ASSERTION);
}

const proxyIface = new Interface(MockProxyABI);
const assertionIface = new Interface(ProxyIntegrityAssertionABI);

function decodedDescription(): ScenarioExplainer {
  return {
    action: "Proxy admin call against MockProxy",
    changes: "Targets MockProxy, a transparent EIP-1967 proxy that all future calls route through",
    risk: "A hidden write to the EIP-1967 implementation slot can silently redirect all future calls to attacker-controlled logic — every future interaction with MockProxy could be hijacked, invisibly, from this point on",
  };
}

// One random address per page load, standing in for "an attacker's contract". callSummary,
// previewPrepare, prepare and buildFrames each ask this question independently, so a per-call
// random would make the summary name an address the signed calldata doesn't contain.
let attackerImplementationAddress: string | null = null;
function attackerImplementation(): string {
  if (!attackerImplementationAddress) attackerImplementationAddress = Wallet.createRandom().address;
  return attackerImplementationAddress;
}

function buildProxyCall(triggerViolation: boolean): { target: string; callData: string; callSummary: string } {
  if (triggerViolation) {
    const attacker = attackerImplementation();
    const callData = hex(getBytes(proxyIface.encodeFunctionData("setImplementation", [attacker])));
    return { target: HEGOTA_MOCK_PROXY, callData, callSummary: `Change proxy implementation to ${shortAddr(attacker)}` };
  }
  const callData = hex(getBytes(proxyIface.encodeFunctionData("implementation", [])));
  return { target: HEGOTA_MOCK_PROXY, callData, callSummary: "Read current proxy implementation" };
}

// The assertion is address-agnostic -- it scans every storage write made during the
// transaction, on any contract touched, for the EIP-1967 implementation slot -- so it takes no
// parameters.
function buildAssertionCall(): DefaultFrameCall {
  const data = hex(
    getBytes(assertionIface.encodeFunctionData("assertNoImplementationChange", [])),
  );
  return { target: HEGOTA_PROXY_INTEGRITY_ASSERTION, data, gasLimit: 200_000 };
}

registerKnownInterface(assertionIface);

registerInnerActionRows(proxyIface.getFunction("setImplementation")!.selector, (callData): CuratedRow[] => {
  const [impl] = proxyIface.decodeFunctionData("setImplementation", callData);
  return [{ label: "New impl", value: shortAddr(impl) }];
});

registerInnerActionRows(proxyIface.getFunction("implementation")!.selector, (): CuratedRow[] => [
  { label: "Reads", value: "implementation() — no storage write" },
]);

registerCuratedRows("assertNoImplementationChange", (): CuratedRow[] => [
  { label: "EIP-1967 slot", value: "must be unwritten" },
]);

export const proxySwapScenario: HegotaWalletScenario<{
  target: string;
  callData: string;
  signature: string;
}> = {
  id: "proxy-swap",
  walletTitle: "Proxy admin call",
  // Explicit: an absent accountKind means "no smart account" to WalletSimulatorPanel.
  accountKind: "erc7579",
  decodedDescription,
  prepare: (provider, signer, chainId, accountAddress, _quoteResult, triggerViolation) => {
    const { target, callData } = buildProxyCall(!!triggerViolation);
    return prepareViaErc7579Account(provider, signer, chainId, accountAddress, target, callData);
  },
  previewPrepare: (provider, chainId, accountAddress, _quoteResult, triggerViolation) => {
    const { target, callData } = buildProxyCall(!!triggerViolation);
    return previewPrepareErc7579Account(provider, chainId, accountAddress, target, callData);
  },
  callSummary: (_quoteResult, triggerViolation) => buildProxyCall(!!triggerViolation).callSummary,
  buildFrames: async ({ provider, accountAddress, senderAddress }, _quoteResult, ctx) => {
    const executeData = encodeExecuteAction(accountAddress, ctx.target, ctx.callData, ctx.signature);
    const assertion = buildAssertionCall();
    const nonceSeq = await fetchSelfVerifyNonce(provider, senderAddress);
    return {
      sender: senderAddress,
      nonceKeys: [0],
      nonceSeq,
      frames: [
        new Frame(FrameMode.VERIFY, 0x03, senderAddress, 80_000, 0, new Uint8Array(0)),
        new Frame(FrameMode.DEFAULT, 0, HEGOTA_POST_TX_EXECUTOR, 500_000, 0, getBytes(executeData)),
        new Frame(FrameMode.POST_TX, 0, assertion.target, assertion.gasLimit, 0, getBytes(assertion.data)),
      ],
    };
  },
  violationToggle: {
    label: "Swap the proxy implementation (write the EIP-1967 slot) instead",
  },
  formatEnforcementText: () => 
    React.createElement(Stack, { spacing: 0.5, sx: { mt: 0.5 } },
      React.createElement(Box, null, "Proxy Implementation:"),
      React.createElement(Box, { sx: { color: theme.palette.success.main, display: "flex", alignItems: "center", gap: 1 } },
        "Locked (no upgrades)"
      )
    ),
};
