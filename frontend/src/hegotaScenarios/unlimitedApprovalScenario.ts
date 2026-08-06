import * as React from "react";
import { Stack } from "@mui/material";
import { Interface, getBytes, AbiCoder, MaxUint256 } from "ethers";
import { Frame, FrameMode, hex } from "../frametx.js";
import { ApprovalCapAssertionABI, MockERC20ABI } from "../contracts/abis.js";
import type { DefaultFrameCall } from "../hegotaWallet.js";
import type { HegotaWalletScenario, ScenarioExplainer } from "./types.js";
import { prepareViaErc7579Account, previewPrepareErc7579Account } from "./types.js";
import { encodeExecuteAction, HEGOTA_POST_TX_EXECUTOR } from "../erc7579Account.js";
import { fetchSelfVerifyNonce, registerCuratedRows, registerKnownInterface } from "../frameSigning.js";
import { registerInnerActionRows } from "./erc7579FrameRows.js";
import type { CuratedRow } from "../signingPreview.js";
import { shortAddr } from "../format.js";
import { registerEnsName, resolveEnsName } from "../ensLabels.js";
import { registerToken, formatTokenAmount } from "./tokenLabels.js";
import theme from "../theme.js";
import EnforcementRow from "../components/hegotaWallet/EnforcementRow.js";

export const HEGOTA_IN_TOKEN = import.meta.env.VITE_HEGOTA_IN_TOKEN ?? "";
export const HEGOTA_APPROVAL_CAP_ASSERTION = import.meta.env.VITE_HEGOTA_APPROVAL_CAP_ASSERTION ?? "";
export const HEGOTA_APPROVAL_SPENDER = import.meta.env.VITE_HEGOTA_MOCK_SWAP ?? "";

export function isApprovalCapConfigured(): boolean {
  return Boolean(HEGOTA_IN_TOKEN && HEGOTA_APPROVAL_CAP_ASSERTION && HEGOTA_APPROVAL_SPENDER);
}

const tokenIface = new Interface(MockERC20ABI);
const assertionIface = new Interface(ApprovalCapAssertionABI);
const abiCoder = AbiCoder.defaultAbiCoder();

registerEnsName(HEGOTA_APPROVAL_SPENDER, "vitalik.eth");
registerToken(HEGOTA_IN_TOKEN, { symbol: "SHIB", decimals: 18 });
const spenderLabel = resolveEnsName(HEGOTA_APPROVAL_SPENDER) ?? shortAddr(HEGOTA_APPROVAL_SPENDER);

// Mirrors contracts/hegota/MinOutputAssertion.sol's ConstraintType enum (re-exported by
// ApprovalCapAssertion.sol).
const ConstraintType = { EQ: 0, GTE: 1, LTE: 2, IN: 3 } as const;

const APPROVAL_CAP = 1_000n * 10n ** 18n;
const COMPLIANT_AMOUNT = 500n * 10n ** 18n;

function decodedDescription(): ScenarioExplainer {
  return {
    action: "Approve a spender to move your tokens",
    changes: `Grants ${spenderLabel} an allowance of up to ${APPROVAL_CAP / 10n ** 18n} SHIB`,
    risk: `A dApp can request an uncapped ("infinite") approval instead of a sane limit — ${spenderLabel} could then drain your entire SHIB balance, at any time, without asking again`,
  };
}

registerKnownInterface(assertionIface);

registerInnerActionRows(tokenIface.getFunction("approve")!.selector, (callData): CuratedRow[] => {
  const [spender, amount] = tokenIface.decodeFunctionData("approve", callData);
  return [
    { label: "Spender", value: resolveEnsName(spender) ?? shortAddr(spender) },
    {
      label: "Allowance",
      value: amount === MaxUint256 ? "Unlimited" : formatTokenAmount(HEGOTA_IN_TOKEN, amount),
    },
  ];
});

registerCuratedRows("assertApprovalCap", (dataHex): CuratedRow[] => {
  const [token, spender, constraint] = assertionIface.decodeFunctionData("assertApprovalCap", dataHex);
  const [cap] = abiCoder.decode(["uint256"], constraint.referenceData);
  return [
    { label: "Spender", value: resolveEnsName(spender) ?? shortAddr(spender) },
    { label: "Allowance cap", value: `≤ ${formatTokenAmount(token, cap)}` },
  ];
});

function buildApproveCall(triggerViolation: boolean): { target: string; callData: string; callSummary: string } {
  const amount = triggerViolation ? MaxUint256 : COMPLIANT_AMOUNT;
  const callData = hex(
    getBytes(tokenIface.encodeFunctionData("approve", [HEGOTA_APPROVAL_SPENDER, amount])),
  );
  const amountLabel = triggerViolation ? "Unlimited" : `${COMPLIANT_AMOUNT / 10n ** 18n} SHIB`;
  return {
    target: HEGOTA_IN_TOKEN,
    callData,
    callSummary: `Approve ${spenderLabel} to spend ${amountLabel}`,
  };
}

function buildAssertionCall(): DefaultFrameCall {
  const referenceData = abiCoder.encode(["uint256"], [APPROVAL_CAP]);
  const constraint = { constraintType: ConstraintType.LTE, referenceData };
  const data = hex(
    getBytes(
      assertionIface.encodeFunctionData("assertApprovalCap", [
        HEGOTA_IN_TOKEN,
        HEGOTA_APPROVAL_SPENDER,
        constraint,
      ]),
    ),
  );
  return { target: HEGOTA_APPROVAL_CAP_ASSERTION, data, gasLimit: 200_000 };
}

export const unlimitedApprovalScenario: HegotaWalletScenario<{
  target: string;
  callData: string;
  signature: string;
}> = {
  id: "unlimited-approval",
  walletTitle: "Approve spender for capped amount",
  // WalletSimulatorPanel reads an ABSENT accountKind as "no smart account at all, the connected
  // wallet is itself the acting account" (shield/withdraw), so leaving it off here would hand
  // buildFrames the EOA and route the approve through PostTxExecutor with the wrong account.
  accountKind: "erc7579",
  decodedDescription,
  prepare: (provider, signer, chainId, accountAddress, _quoteResult, triggerViolation) => {
    const { target, callData } = buildApproveCall(!!triggerViolation);
    return prepareViaErc7579Account(provider, signer, chainId, accountAddress, target, callData);
  },
  previewPrepare: (provider, chainId, accountAddress, _quoteResult, triggerViolation) => {
    const { target, callData } = buildApproveCall(!!triggerViolation);
    return previewPrepareErc7579Account(provider, chainId, accountAddress, target, callData);
  },
  callSummary: (_quoteResult, triggerViolation) => buildApproveCall(!!triggerViolation).callSummary,
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
  formatEnforcementText: () =>
    React.createElement(Stack, { spacing: 1, sx: { mt: 0.5 } },
      React.createElement(EnforcementRow, { label: "Spender:", value: spenderLabel }),
      React.createElement(EnforcementRow, {
        label: "Allowance cap:",
        value: `≤ ${formatTokenAmount(HEGOTA_IN_TOKEN, APPROVAL_CAP)}`,
        color: theme.palette.error.main,
      }),
    ),
  violationToggle: {
    label: "Request an uncapped (\"infinite\") approval instead",
  },
};
