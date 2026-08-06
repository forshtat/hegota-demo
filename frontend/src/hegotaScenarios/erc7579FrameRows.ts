// All five ERC-7579-backed attack scenarios put the SAME function in their DEFAULT frame --
// PostTxExecutor.executeAction(account, validator, target, callData, signature) -- and
// frameSigning.ts's curated-row registry is keyed by function name alone, so five separate
// registerCuratedRows("executeAction", ...) calls would overwrite one another. So it's
// registered exactly once, here, and routes on the *inner* action call's 4-byte selector to
// whatever rows the scenario that owns that action registered for it.

import { Interface } from "ethers";
import { PostTxExecutorABI } from "../contracts/abis.js";
import { registerCuratedRows, registerKnownInterface } from "../frameSigning.js";
import type { CuratedRow } from "../signingPreview.js";

const executorIface = new Interface(PostTxExecutorABI);

// Without this the DEFAULT frame's calldata matches no known ABI at all and the frame screen
// falls back to raw hex -- decodeFrameData only knows the interfaces registered with it.
registerKnownInterface(executorIface);

type InnerActionRowsBuilder = (callData: string, target: string) => CuratedRow[];

const INNER_BUILDERS: Record<string, InnerActionRowsBuilder> = {};

/** Selectors are unique per action across the five ERC-7579 scenarios; the two swap scenarios
 *  deliberately share one (same MockSwap.swap call, same rows). */
export function registerInnerActionRows(selector: string, builder: InnerActionRowsBuilder): void {
  INNER_BUILDERS[selector.toLowerCase()] = builder;
}

registerCuratedRows("executeAction", (dataHex): CuratedRow[] | null => {
  const [, , target, callData] = executorIface.decodeFunctionData("executeAction", dataHex);
  const inner = callData as string;
  const builder = INNER_BUILDERS[inner.slice(0, 10).toLowerCase()];
  // Null (not []) for an unregistered action: describeFrameTx then shows executeAction's own
  // decoded arguments rather than an empty row list.
  return builder ? builder(inner, target as string) : null;
});
