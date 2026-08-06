// TestSubject.sendEthToTwo forwards value out of ITS OWN balance via low-level `.call` (it
// does not require msg.value to cover the two sends) -- this matters because
// PostTxExecutor.executeAction always forwards value=0 when routing the DEFAULT frame through
// the ERC-7579 smart-account path used here. TestSubject is pre-funded with 0.05 ETH for
// exactly this reason (see scripts/deploy-hegota.mjs), so this scenario never needs to attach a
// frame value at all.

import * as React from "react";
import { Stack, Box } from "@mui/material";
import { Interface, getBytes, Wallet } from "ethers";
import { Frame, FrameMode, hex } from "../frametx.js";
import { ExactBeneficiaryAssertionABI, TestSubjectABI } from "../contracts/abis.js";
import type { DefaultFrameCall } from "../hegotaWallet.js";
import type { HegotaWalletScenario, ScenarioExplainer } from "./types.js";
import { prepareViaErc7579Account, previewPrepareErc7579Account } from "./types.js";
import { encodeExecuteAction, HEGOTA_POST_TX_EXECUTOR } from "../erc7579Account.js";
import { fetchSelfVerifyNonce, registerCuratedRows, registerKnownInterface } from "../frameSigning.js";
import { registerInnerActionRows } from "./erc7579FrameRows.js";
import type { CuratedRow } from "../signingPreview.js";
import { shortAddr } from "../format.js";
import theme from "../theme.js";

export const HEGOTA_TEST_SUBJECT = import.meta.env.VITE_HEGOTA_TEST_SUBJECT ?? "";
export const HEGOTA_EXACT_BENEFICIARY_ASSERTION = import.meta.env.VITE_HEGOTA_EXACT_BENEFICIARY_ASSERTION ?? "";

export function isExactBeneficiaryConfigured(): boolean {
  return Boolean(HEGOTA_TEST_SUBJECT && HEGOTA_EXACT_BENEFICIARY_ASSERTION);
}

const subjectIface = new Interface(TestSubjectABI);
const assertionIface = new Interface(ExactBeneficiaryAssertionABI);

const LEGIT_AMOUNT = 1_000_000_000_000_000n; // 0.001 ETH
const HIDDEN_AMOUNT = 1_000_000_000_000_000n; // 0.001 ETH

function decodedDescription(): ScenarioExplainer {
  return {
    action: "Send ETH to the declared recipient",
    changes: "Bundles this visible transfer with a second, hidden leg in the same multicall",
    risk: "A hidden second leg can quietly send ETH to an attacker-controlled address alongside the visible transfer — siphoning funds on every transaction, with no visible sign in the wallet UI",
  };
}

function ethLabel(wei: bigint): string {
  return `${Number(wei) / 1e18} ETH`;
}

// One random address per page load, standing in for "some attacker address the wallet UI never
// shows". callSummary, previewPrepare, prepare and buildFrames each ask this question
// independently, so a per-call random would make the summary name an address the calldata
// doesn't contain. Generated lazily so module load doesn't depend on crypto being available.
let hiddenRecipientAddress: string | null = null;
function hiddenRecipient(): string {
  if (!hiddenRecipientAddress) hiddenRecipientAddress = Wallet.createRandom().address;
  return hiddenRecipientAddress;
}

/** The Clear Signing line for this action; `callSummary` has no account address to build
 *  calldata with -- and never needs one: the declared recipient IS the acting account,
 *  rendered as "You". */
function sendCallSummary(triggerViolation: boolean): string {
  return triggerViolation
    ? `Send ${ethLabel(LEGIT_AMOUNT)} to You AND ${ethLabel(HIDDEN_AMOUNT)} to ${shortAddr(hiddenRecipient())}`
    : `Send ${ethLabel(LEGIT_AMOUNT)} to You`;
}

function buildSendCall(accountAddress: string, triggerViolation: boolean): { target: string; callData: string; callSummary: string } {
  const hiddenRecipient_ = hiddenRecipient();
  const hiddenAmount = triggerViolation ? HIDDEN_AMOUNT : 0n;
  const callData = hex(
    getBytes(
      subjectIface.encodeFunctionData("sendEthToTwo", [
        accountAddress, LEGIT_AMOUNT,
        hiddenRecipient_, hiddenAmount,
      ]),
    ),
  );
  return { target: HEGOTA_TEST_SUBJECT, callData, callSummary: sendCallSummary(triggerViolation) };
}

function buildAssertionCall(accountAddress: string): DefaultFrameCall {
  const data = hex(
    getBytes(assertionIface.encodeFunctionData("assertExactBeneficiary", [accountAddress])),
  );
  return { target: HEGOTA_EXACT_BENEFICIARY_ASSERTION, data, gasLimit: 200_000 };
}

registerKnownInterface(assertionIface);

registerInnerActionRows(subjectIface.getFunction("sendEthToTwo")!.selector, (callData): CuratedRow[] => {
  const [to1, amount1, to2, amount2] = subjectIface.decodeFunctionData("sendEthToTwo", callData);
  // Short labels: the device screen is 380px wide and a longer label pushes the value onto a
  // second line mid-word.
  const rows: CuratedRow[] = [{ label: "To", value: `${ethLabel(amount1)} → ${shortAddr(to1)}` }];
  if (amount2 > 0n) rows.push({ label: "Hidden", value: `${ethLabel(amount2)} → ${shortAddr(to2)}` });
  return rows;
});

registerCuratedRows("assertExactBeneficiary", (dataHex): CuratedRow[] => {
  const [beneficiary] = assertionIface.decodeFunctionData("assertExactBeneficiary", dataHex);
  return [{ label: "Allowed beneficiary", value: shortAddr(beneficiary) }];
});

export const hiddenEthDrainScenario: HegotaWalletScenario<{
  target: string;
  callData: string;
  signature: string;
}> = {
  id: "hidden-eth-drain",
  walletTitle: "Send ETH to declared recipient",
  // Explicit: an absent accountKind means "no smart account" to WalletSimulatorPanel.
  accountKind: "erc7579",
  decodedDescription,
  prepare: (provider, signer, chainId, accountAddress, _quoteResult, triggerViolation) => {
    const { target, callData } = buildSendCall(accountAddress, !!triggerViolation);
    return prepareViaErc7579Account(provider, signer, chainId, accountAddress, target, callData);
  },
  previewPrepare: (provider, chainId, accountAddress, _quoteResult, triggerViolation) => {
    const { target, callData } = buildSendCall(accountAddress, !!triggerViolation);
    return previewPrepareErc7579Account(provider, chainId, accountAddress, target, callData);
  },
  callSummary: (_quoteResult, triggerViolation) => sendCallSummary(!!triggerViolation),
  buildFrames: async ({ provider, accountAddress, senderAddress }, _quoteResult, ctx) => {
    const executeData = encodeExecuteAction(accountAddress, ctx.target, ctx.callData, ctx.signature);
    const assertion = buildAssertionCall(accountAddress);
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
    label: "Also send ETH to a hidden second address",
  },
  formatEnforcementText: () => 
    React.createElement(Stack, { spacing: 0.5, sx: { mt: 0.5 } },
      React.createElement(Box, null, "Allowed Beneficiary:"),
      React.createElement(Box, { sx: { color: theme.palette.success.main, display: "flex", alignItems: "center", gap: 1 } },
        "You only"
      )
    ),
};
