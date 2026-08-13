// The MinOutput / anti-sandwich scenario: the first "simulate -> commit -> enforce" demo.
//
// Unlike the other Hegotá scenarios (where the expected outcome is already fully known
// from the calldata being built), a swap's output genuinely depends on live chain state.
// Real swap functions rarely return anything trustworthy to simulate off of, though -- most
// don't return the output amount at all, and even when they do, wallets/DEX frontends don't
// rely on it. They quote by reading pool/price state via a view call and replicating the
// pricing formula client-side (the same thing Uniswap's SDK does with reserves/tick math).
// `simulateSwap` below does the same: reads `MockSwap.rateNumerator()` and applies its
// pricing formula in TypeScript, rather than calling the mutating `swap` function and
// trusting a return value. `MockSwap` (see contracts/hegota/MockSwap.sol) has an adjustable
// rate, so a sandwich attack can be modeled by moving it between when the widget quotes the
// swap and when the real transaction executes.

import { Interface, getBytes, AbiCoder, type BrowserProvider } from "ethers";
import { hex } from "./frametx.js";
import { MinOutputAssertionABI, MockSwapABI } from "./contracts/abis.js";
import { connectRelayWallet, lowFeeOverrides, type DefaultFrameCall } from "./hegotaWallet.js";

export const HEGOTA_IN_TOKEN = import.meta.env.VITE_HEGOTA_IN_TOKEN ?? "";
export const HEGOTA_OUT_TOKEN = import.meta.env.VITE_HEGOTA_OUT_TOKEN ?? "";
export const HEGOTA_MOCK_SWAP = import.meta.env.VITE_HEGOTA_MOCK_SWAP ?? "";
export const HEGOTA_MIN_OUTPUT_ASSERTION = import.meta.env.VITE_HEGOTA_MIN_OUTPUT_ASSERTION ?? "";

export function isMinOutputConfigured(): boolean {
  return Boolean(HEGOTA_IN_TOKEN && HEGOTA_OUT_TOKEN && HEGOTA_MOCK_SWAP && HEGOTA_MIN_OUTPUT_ASSERTION);
}

const swapIface = new Interface(MockSwapABI);
const assertionIface = new Interface(MinOutputAssertionABI);
const abiCoder = AbiCoder.defaultAbiCoder();

// Mirrors MockSwap.sol's own constant. It's `constant`, not read state, so hardcoding it
// here (rather than fetching it) just mirrors what's already baked into the ABI/bytecode.
const RATE_DENOMINATOR = 10n ** 18n;

// Mirrors contracts/hegota/MinOutputAssertion.sol's ConstraintType enum and ERC-8211's
// Constraint vocabulary.
export const ConstraintType = { EQ: 0, GTE: 1, LTE: 2, IN: 3 } as const;

/**
 * Predicts the swap's output the way a real wallet/DEX frontend would: reads the pool's
 * current price state via a plain view call (`rateNumerator`) and applies MockSwap's own
 * pricing formula client-side, instead of calling the mutating `swap` function and trusting
 * its return value. Still a genuine live read against current chain state — just not a
 * simulation of the mutating call itself.
 */
export async function simulateSwap(provider: BrowserProvider, recipient: string, amountIn: bigint): Promise<bigint> {
  const rate = await currentRate(provider, recipient);
  return (amountIn * rate) / RATE_DENOMINATOR;
}

/** Builds just the DEFAULT (swap) frame's target/calldata, split out from
 *  buildMinOutputFrames so scenario objects (hegotaScenarios/minOutputScenarios.ts) can
 *  drive it independently of the assertion half. */
export function buildSwapCall(
  from: string,
  amountIn: bigint,
  recipient: string,
): { target: string; callData: string } {
  const callData = hex(getBytes(swapIface.encodeFunctionData("swap", [from, amountIn, recipient])));
  return { target: HEGOTA_MOCK_SWAP, callData };
}

/** Builds the POST_TX (MinOutputAssertion, GTE minAmount) frame call. */
export function buildAssertionCall(minAmount: bigint, recipient: string): DefaultFrameCall {
  const referenceData = abiCoder.encode(["uint256"], [minAmount]);
  const constraint = { constraintType: ConstraintType.GTE, referenceData };
  const data = hex(
    getBytes(assertionIface.encodeFunctionData("assertMinOutput", [HEGOTA_OUT_TOKEN, recipient, constraint])),
  );
  return { target: HEGOTA_MIN_OUTPUT_ASSERTION, data, gasLimit: 200_000 };
}

/** Builds the DEFAULT (swap) and POST_TX (MinOutputAssertion, GTE minAmount) frame calls. */
export function buildMinOutputFrames(
  from: string,
  amountIn: bigint,
  recipient: string,
  minAmount: bigint,
): { defaultFrame: DefaultFrameCall; postTxFrame: DefaultFrameCall } {
  const swapCall = buildSwapCall(from, amountIn, recipient);
  return {
    // MockSwap.swap moves three ERC-20 balance slots, and under EIP-8037 state-gas
    // repricing that measures ~198k on Hegotá, so the original 150_000 made this frame
    // halt out-of-gas every time and the whole scenario fail. Unused frame gas is
    // refunded, so the headroom costs nothing beyond the payer's max-cost reservation.
    defaultFrame: { target: swapCall.target, data: swapCall.callData, gasLimit: 300_000 },
    postTxFrame: buildAssertionCall(minAmount, recipient),
  };
}

/** Reads MockSwap's current rate for a given recipient (view call, no `from` needed). The
 *  rate is scoped per recipient — see MockSwap.sol's own comment for why. */
export async function currentRate(provider: BrowserProvider, recipient: string): Promise<bigint> {
  const data = swapIface.encodeFunctionData("rateNumerator", [recipient]);
  const result = await provider.call({ to: HEGOTA_MOCK_SWAP, data });
  return swapIface.decodeFunctionResult("rateNumerator", result)[0] as bigint;
}

/**
 * Demo-only "attacker" action: moves MockSwap's rate, sponsored by the relay key so the
 * page doesn't need a second connected signer to play the attacker's role. Lets the widget
 * demonstrate a sandwich attack live: simulate/commit at the current rate, move the rate
 * here, then submit — the real output falls below the committed minimum and the POST_TX
 * frame reverts the whole transaction.
 *
 * Built and sent via raw provider.send() calls throughout (never ethers' high-level
 * sendTransaction/wait): once a recent block contains one of our frame transactions,
 * ethers' internal block-confirmation polling (used by those convenience methods) can
 * crash trying to parse it as a legacy/EIP-1559-shaped transaction — reproduced directly
 * against Hegotá while building this demo. Hitting a frame-tx-containing block is exactly
 * what happens here, right after this scenario submits one.
 */
export async function sandwichRate(provider: BrowserProvider, recipient: string, newRateNumerator: bigint): Promise<void> {
  const relay = connectRelayWallet(provider);
  // "latest" (confirmed), not "pending": this devnet's mempool can accumulate orphaned
  // transactions that never get included (gossip is best-effort per the devnet docs), and
  // "pending" projects past that gap rather than reporting the real next usable nonce. Safe
  // here since this demo only ever sends one transaction at a time from this key.
  const nonce = await provider.send("eth_getTransactionCount", [relay.address, "latest"]);
  const chainIdHex = await provider.send("eth_chainId", []);

  const signedTx = await relay.signTransaction({
    type: 2,
    chainId: BigInt(chainIdHex),
    nonce: parseInt(nonce, 16),
    to: HEGOTA_MOCK_SWAP,
    data: swapIface.encodeFunctionData("setRate", [recipient, newRateNumerator]),
    // A cold (first-time) write to _rateOverride[recipient] measured at ~124,899 gas on
    // Hegotá -- well above what a single SSTORE costs on mainnet-like gas schedules.
    // 200,000 leaves real headroom.
    gasLimit: 200_000n,
    ...(await lowFeeOverrides(provider)),
  });
  const txHash = await provider.send("eth_sendRawTransaction", [signedTx]);
  for (let i = 0; i < 20; i++) {
    const receipt = await provider.send("eth_getTransactionReceipt", [txHash]);
    if (receipt) {
      if (receipt.status !== "0x1") {
        throw new Error(`setRate transaction ${txHash} reverted (status ${receipt.status})`);
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`setRate transaction ${txHash} did not confirm within the poll window`);
}
