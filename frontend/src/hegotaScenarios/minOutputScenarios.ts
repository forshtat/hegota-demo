// MEV Sandwich and Oracle Manipulation are the same underlying swap+assertion pair (hegotaMinOutput.ts's
// MockSwap/MinOutputAssertion), kept as two separate scenario objects differing only in narrative framing.

import * as React from "react";
import { Stack, Box } from "@mui/material";
import { Interface, getBytes } from "ethers";
import { Frame, FrameMode } from "../frametx.js";
import { MinOutputAssertionABI, MockSwapABI } from "../contracts/abis.js";
import type { FrameTxPlan } from "../hegotaWallet.js";
import type { FrameBuildEnv, HegotaWalletScenario, ScenarioExplainer } from "./types.js";
import { prepareViaErc7579Account, previewPrepareErc7579Account } from "./types.js";
import { encodeExecuteAction, HEGOTA_POST_TX_EXECUTOR } from "../erc7579Account.js";
import { fetchSelfVerifyNonce, registerCuratedRows, registerKnownInterface } from "../frameSigning.js";
import { registerInnerActionRows } from "./erc7579FrameRows.js";
import type { CuratedRow } from "../signingPreview.js";
import {
  simulateSwap, currentRate, sandwichRate, buildSwapCall, buildAssertionCall,
  HEGOTA_IN_TOKEN, HEGOTA_OUT_TOKEN,
} from "../hegotaMinOutput.js";
import { registerToken, formatTokenAmount } from "./tokenLabels.js";
import theme from "../theme.js";

const swapIface = new Interface(MockSwapABI);
const assertionIface = new Interface(MinOutputAssertionABI);

registerToken(HEGOTA_IN_TOKEN, { symbol: "SHIB", decimals: 18 });
registerToken(HEGOTA_OUT_TOKEN, { symbol: "PEPE", decimals: 18 });

registerKnownInterface(assertionIface);

registerInnerActionRows(swapIface.getFunction("swap")!.selector, (callData): CuratedRow[] => {
  const [, amountIn] = swapIface.decodeFunctionData("swap", callData);
  return [{ label: "Swapping", value: formatTokenAmount(HEGOTA_IN_TOKEN, amountIn) }];
});

registerCuratedRows("assertMinOutput", (dataHex): CuratedRow[] => {
  const [outToken, , constraint] = assertionIface.decodeFunctionData("assertMinOutput", dataHex);
  const [minAmount] = swapIface.getAbiCoder().decode(["uint256"], constraint.referenceData);
  return [{ label: "Minimum out", value: `≥ ${formatTokenAmount(outToken, minAmount)}` }];
});

function formatSwapEnforcementText(quoteResult: bigint | null) {
  if (quoteResult === null) return undefined;
  return React.createElement(Stack, { spacing: 0.5, sx: { mt: 0.5 } },
    React.createElement(Box, { sx: { color: theme.palette.error.main, display: "flex", alignItems: "center", gap: 1 } },
      React.createElement("span", null, "⬇"), " - 100.00 SHIB"
    ),
    React.createElement(Box, { sx: { color: theme.palette.success.main, display: "flex", alignItems: "center", gap: 1 } },
      React.createElement("span", null, "⬆"), ` ≥ +${(Number(quoteResult) / 1e18).toFixed(4)} PEPE`
    )
  );
}

const amountIn = 100n * 10n ** 18n;

function swapDecodedDescription(risk: string): ScenarioExplainer {
  return {
    action: "Swap 100 SHIB for PEPE",
    changes: "Executes a swap against the live MockSwap pool at the quoted rate",
    risk,
  };
}

type SwapContext = { target: string; callData: string; signature: string };

async function buildSwapFrames(
  { provider, accountAddress, senderAddress }: FrameBuildEnv,
  quoteResult: bigint | null,
  ctx: SwapContext,
): Promise<FrameTxPlan> {
  if (quoteResult === null) throw new Error("minOutput buildFrames: missing quote result");
  const executeData = encodeExecuteAction(accountAddress, ctx.target, ctx.callData, ctx.signature);
  // The committed minimum is the quote taken BEFORE the attacker moved the rate -- that gap is
  // exactly what the POST_TX frame catches.
  const assertion = buildAssertionCall(quoteResult, accountAddress);
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
}

const swapPrepare: HegotaWalletScenario<SwapContext>["prepare"] =
  (provider, signer, chainId, accountAddress) => {
    const { target, callData } = buildSwapCall(accountAddress, amountIn, accountAddress);
    return prepareViaErc7579Account(provider, signer, chainId, accountAddress, target, callData);
  };

const swapPreviewPrepare: HegotaWalletScenario<SwapContext>["previewPrepare"] =
  (provider, chainId, accountAddress) => {
    const { target, callData } = buildSwapCall(accountAddress, amountIn, accountAddress);
    return previewPrepareErc7579Account(provider, chainId, accountAddress, target, callData);
  };

export const mevSandwichScenario: HegotaWalletScenario<SwapContext> = {
  id: "mev-sandwich",
  walletTitle: "Swap 100 SHIB → PEPE",
  // Explicit: an absent accountKind means "no smart account" to WalletSimulatorPanel.
  accountKind: "erc7579",
  decodedDescription: () =>
    swapDecodedDescription(
      "An MEV bot can sandwich this swap, moving the pool price between quote and execution — you'd receive less PEPE than quoted, and the bot pockets the difference",
    ),
  quote: (provider, accountAddress) => simulateSwap(provider, accountAddress, amountIn),
  prepare: swapPrepare,
  previewPrepare: swapPreviewPrepare,
  callSummary: () => "Swap 100 SHIB for PEPE",
  buildFrames: (env, quoteResult, ctx) => buildSwapFrames(env, quoteResult, ctx),
  formatEnforcementText: formatSwapEnforcementText,
  attacker: {
    label: "Simulate an MEV bot sandwiching this swap",
    apply: (provider, accountAddress) =>
      currentRate(provider, accountAddress).then((rate) => sandwichRate(provider, accountAddress, rate / 2n)),
  },
};

export const oracleManipulationScenario: HegotaWalletScenario<SwapContext> = {
  id: "oracle-manipulation",
  walletTitle: "Swap 100 SHIB → PEPE (stale oracle)",
  accountKind: "erc7579",
  decodedDescription: () =>
    swapDecodedDescription(
      "A stale or manipulated price oracle can understate the real exchange rate — you'd receive less PEPE than fair value, and the shortfall goes to whoever manipulated the price",
    ),
  quote: (provider, accountAddress) => simulateSwap(provider, accountAddress, amountIn),
  prepare: swapPrepare,
  previewPrepare: swapPreviewPrepare,
  callSummary: () => "Swap 100 SHIB for PEPE",
  buildFrames: (env, quoteResult, ctx) => buildSwapFrames(env, quoteResult, ctx),
  formatEnforcementText: formatSwapEnforcementText,
  attacker: {
    label: "Simulate the price oracle going stale mid-transaction",
    apply: (provider, accountAddress) =>
      currentRate(provider, accountAddress).then((rate) => sandwichRate(provider, accountAddress, rate / 2n)),
  },
};
