// Unlike every other Hegotá-native scenario, this one is authorized through the connected
// wallet's own Gnosis Safe, not an ERC-7579 smart account -- see `accountKind` below.
//
// Models the February 2025 Bybit hack: a compromised signing UI disguised a Safe
// control-plane hijack (lowering the threshold, clearing the guard) as a routine transfer.
// `prepareViaSafe` unconditionally dispatches via Safe.execTransaction(operation=1
// DELEGATECALL) -- there is no CALL-mode escape hatch here -- so BOTH variants of
// buildSafeAction below execute in the SAFE's own storage context: compliant DELEGATECALLs into
// BenignSafeDelegate.noop() (`pure`, touches no storage), violating DELEGATECALLs into
// MaliciousSafeDelegate.approve(...), which rewrites the Safe's own threshold/guard slots.

import * as React from "react";
import { Stack, Box, Divider } from "@mui/material";
import { Interface, getBytes } from "ethers";
import { Frame, FrameMode, hex } from "../frametx.js";
import { shortAddr } from "../format.js";
import { registerEnsName, resolveEnsName } from "../ensLabels.js";
import { registerToken, formatTokenAmount } from "./tokenLabels.js";
import theme from "../theme.js";
import EnforcementRow from "../components/hegotaWallet/EnforcementRow.js";
import { MaliciousSafeDelegateABI, BenignSafeDelegateABI, SafeControlPlaneAssertionABI } from "../contracts/abis.js";
import { SAFE_ABI } from "../contracts/safeExec.js";
import type { DefaultFrameCall } from "../hegotaWallet.js";
import type { HegotaWalletScenario, ScenarioExplainer } from "./types.js";
import { prepareViaSafe, previewPrepareSafe } from "./types.js";
import { fetchSelfVerifyNonce, registerCuratedRows, registerKnownInterface } from "../frameSigning.js";
import type { CuratedRow } from "../signingPreview.js";

export const HEGOTA_MALICIOUS_SAFE_DELEGATE = import.meta.env.VITE_HEGOTA_MALICIOUS_SAFE_DELEGATE ?? "";
export const HEGOTA_BENIGN_SAFE_DELEGATE = import.meta.env.VITE_HEGOTA_BENIGN_SAFE_DELEGATE ?? "";
export const HEGOTA_SAFE_CONTROL_PLANE_ASSERTION = import.meta.env.VITE_HEGOTA_SAFE_CONTROL_PLANE_ASSERTION ?? "";

export function isControlPlaneTakeoverConfigured(): boolean {
  return Boolean(
    HEGOTA_MALICIOUS_SAFE_DELEGATE && HEGOTA_BENIGN_SAFE_DELEGATE && HEGOTA_SAFE_CONTROL_PLANE_ASSERTION,
  );
}

const maliciousIface = new Interface(MaliciousSafeDelegateABI);
const benignIface = new Interface(BenignSafeDelegateABI);
const assertionIface = new Interface(SafeControlPlaneAssertionABI);

function decodedDescription(): ScenarioExplainer {
  return {
    action: "A routine Safe transaction",
    changes: "DELEGATECALLs into a contract that can rewrite your Safe's own threshold and guard storage",
    risk: "A disguised transaction can silently strip your Safe's multisig protection — giving an attacker full control, able to move any funds and add or remove any signer",
  };
}

import { ADDRESSES } from "../contracts/addresses.js";
import { MockERC20ABI } from "../contracts/abis.js";
import { Wallet } from "ethers";

const tokenIface = new Interface(MockERC20ABI);

const FAKE_SPENDER = "0x605f3e20ede5943b7b91b4226d9c4b8d18e65b2d";
const DECOY_APPROVAL_AMOUNT = 1_000n * 10n ** 18n;

registerEnsName(FAKE_SPENDER, "vitalik.eth");
registerToken(ADDRESSES.ua.token, { symbol: "SHIB", decimals: 18 });
const spenderLabel = resolveEnsName(FAKE_SPENDER) ?? shortAddr(FAKE_SPENDER);

function buildSafeAction(triggerViolation: boolean): { target: string; callData: string; callSummary: string; operation?: number } {
  const callData = hex(getBytes(tokenIface.encodeFunctionData("approve", [FAKE_SPENDER, DECOY_APPROVAL_AMOUNT])));
  const callSummary = `Approve ${spenderLabel} to spend ${formatTokenAmount(ADDRESSES.ua.token, DECOY_APPROVAL_AMOUNT)}`;

  if (triggerViolation) {
    return { target: HEGOTA_MALICIOUS_SAFE_DELEGATE, callData, operation: 1, callSummary };
  }
  return { target: ADDRESSES.ua.token, callData, operation: 0, callSummary };
}

function buildAssertionCall(safeAddress: string): DefaultFrameCall {
  const data = hex(
    getBytes(assertionIface.encodeFunctionData("assertSafeControlPlaneUnchanged", [safeAddress])),
  );
  return { target: HEGOTA_SAFE_CONTROL_PLANE_ASSERTION, data, gasLimit: 200_000 };
}

const safeIface = new Interface(SAFE_ABI);
registerKnownInterface(safeIface);
registerKnownInterface(assertionIface);

registerCuratedRows("execTransaction", (dataHex): CuratedRow[] => {
  const [to, , data, operation] = safeIface.decodeFunctionData("execTransaction", dataHex);
  // Every value here is kept short and single-line: DeviceScreen is 380px wide with a fixed
  // height and never scrolls, so a long value both wraps its own label mid-word and pushes
  // later rows off the bottom of the screen entirely.
  const rows: CuratedRow[] = [
    { label: "Dispatch", value: operation === 1n ? "DELEGATECALL" : "CALL" },
    { label: "Into", value: shortAddr(to) },
  ];
  if (operation === 1n) {
    rows.push({ label: "Runs in", value: "your Safe's storage" });
  } else {
    const inner = data as string;
    if (inner.slice(0, 10).toLowerCase() === tokenIface.getFunction("approve")!.selector.toLowerCase()) {
      const [spender] = tokenIface.decodeFunctionData("approve", inner);
      rows.push({ label: "Approves", value: resolveEnsName(spender) ?? shortAddr(spender) });
    }
  }
  return rows;
});

registerCuratedRows("assertSafeControlPlaneUnchanged", (dataHex): CuratedRow[] => {
  const [safeAddress] = assertionIface.decodeFunctionData("assertSafeControlPlaneUnchanged", dataHex);
  return [
    { label: "Safe", value: shortAddr(safeAddress) },
    { label: "Must hold", value: "threshold & guard unchanged" },
  ];
});

export const controlPlaneTakeoverScenario: HegotaWalletScenario<{
  signedSafeTx: { target: string; data: string; gasLimit: number };
}> = {
  id: "control-plane-takeover",
  walletTitle: "Safe transaction",
  accountKind: "safe",
  decodedDescription,
  // The inner authorization is a real SafeTx signature, not an ERC-7579 one -- and its
  // `operation` is what the violating variant actually changes (DELEGATECALL vs CALL), so it is
  // threaded through to both prepare and previewPrepare.
  prepare: (provider, signer, chainId, accountAddress, _quoteResult, triggerViolation) => {
    const { target, callData, operation } = buildSafeAction(!!triggerViolation);
    return prepareViaSafe(provider, signer, chainId, accountAddress, target, callData, operation);
  },
  previewPrepare: (provider, chainId, accountAddress, _quoteResult, triggerViolation) => {
    const { target, callData, operation } = buildSafeAction(!!triggerViolation);
    return previewPrepareSafe(provider, chainId, accountAddress, target, callData, operation);
  },
  callSummary: (_quoteResult, triggerViolation) => buildSafeAction(!!triggerViolation).callSummary,
  // The Safe's own execTransaction call IS the DEFAULT frame -- no executor wrapper -- so the
  // context's signedSafeTx goes in verbatim, gas limit included (400,000, from
  // buildSafeExecTransaction's own default).
  buildFrames: async ({ provider, accountAddress, senderAddress }, _quoteResult, { signedSafeTx }) => {
    const assertion = buildAssertionCall(accountAddress);
    const nonceSeq = await fetchSelfVerifyNonce(provider, senderAddress);
    return {
      sender: senderAddress,
      nonceKeys: [0],
      nonceSeq,
      frames: [
        new Frame(FrameMode.VERIFY, 0x03, senderAddress, 80_000, 0, new Uint8Array(0)),
        new Frame(FrameMode.DEFAULT, 0, signedSafeTx.target, signedSafeTx.gasLimit, 0, getBytes(signedSafeTx.data)),
        new Frame(FrameMode.POST_TX, 0, assertion.target, assertion.gasLimit, 0, getBytes(assertion.data)),
      ],
    };
  },
  violationToggle: {
    label: "Disguise a control-plane hijack as this transaction instead",
  },
  formatEnforcementText: () =>
    React.createElement(Stack, { spacing: 1, sx: { mt: 0.5 } },
      React.createElement(EnforcementRow, { label: "Spender:", value: spenderLabel }),
      React.createElement(EnforcementRow, {
        label: "Allowance:",
        value: formatTokenAmount(ADDRESSES.ua.token, DECOY_APPROVAL_AMOUNT),
        color: theme.palette.error.main,
      }),
      React.createElement(Divider, { sx: { borderColor: "divider", my: 0.5 } }),
      React.createElement(Box, { sx: { color: theme.palette.success.main, display: "flex", alignItems: "center", gap: 1 } },
        "Account owners & configuration unchanged"
      )
    ),
};
