// The Private Swap page's withdraw ("private swap") half, as a HegotaWalletScenario -- the
// same interface shield (shieldScenario.ts) and the six attack scenarios migrated onto. Unlike
// every other scenario in this codebase, this one is not a static, module-level singleton: it
// closes over a specific SecretNote (which note is being spent), a per-run piece of state no
// other scenario has, so it's built fresh per withdrawal attempt via `buildPrivateSwapScenario`.
//
// No `prepare`/`previewPrepare`: there is nothing for the connected wallet to separately
// authorize here. The ZK proof buildFrames generates *is* the authorization -- ShieldedPoolLogic
// checks it on-chain, not a signature. No `quote` either: unlike MEV Sandwich/Oracle
// Manipulation's live price read, this flow's "quote" (the swap's minimum output) can only be
// computed once buildFrames has already produced spend.publicAmount, which needs the finished
// proof -- there's no cheaper action to gate a separate "Simulate" step on.
//
// Frame shape (pool-as-sender, distinct from every self-verify scenario elsewhere in this
// codebase -- see privateSwapTx.ts's own file-header comment, and FrameBuildEnv's own doc
// comment in hegotaScenarios/types.ts for the general rule this is the one exception to):
// VERIFY(target=pool) checks the proof and self-approves, so the outer envelope signature
// doesn't need to belong to `sender` the way a self-verify VERIFY(self) frame's does. Here
// plan.sender is deliberately the pool, not senderAddress, and any key can still sign the
// envelope regardless of who the real sender is.

import { getBytes, formatEther, Contract } from "ethers";
import { Frame, FrameMode } from "../frametx.js";
import type { HegotaWalletScenario, ScenarioExplainer } from "../hegotaScenarios/types.js";
import { HEGOTA_CHAIN_ID } from "../hegotaWallet.js";
import { domainScalar } from "./note.js";
import { hex32 } from "./poseidon.js";
import { syncTreeFromChain } from "./syncTree.js";
import { buildWithdrawSpend } from "./spend.js";
import { poolIface, executorIface, assertionIface, recentRootRef } from "./privateSwapTx.js";
import type { SecretNote } from "./noteTicket.js";
import { ShieldedPoolABI, MockSwapETHABI } from "../contracts/abis.js";

const POOL = import.meta.env.VITE_HEGOTA_POOL ?? "";
const SOURCE_ID = import.meta.env.VITE_HEGOTA_POOL_SOURCE_ID ?? "";
const DEPLOY_BLOCK = parseInt(import.meta.env.VITE_HEGOTA_POOL_DEPLOY_BLOCK ?? "0");
const OUT_TOKEN = import.meta.env.VITE_HEGOTA_PRIVATE_SWAP_OUT_TOKEN ?? "";
const MOCK_SWAP = import.meta.env.VITE_HEGOTA_PRIVATE_SWAP_MOCK_SWAP ?? "";
const EXECUTOR = import.meta.env.VITE_HEGOTA_PRIVATE_SWAP_EXECUTOR ?? "";
const ASSERTION = import.meta.env.VITE_HEGOTA_PRIVATE_SWAP_ASSERTION ?? "";

/** 0.0005 ETH -- comfortably above this devnet's tx max_cost. The single source of the fee, same
 *  reasoning as shieldScenario.ts's SHIELD_VALUE: the scenario that actually builds the
 *  fee-carrying frame owns the constant, so PrivateSwap.tsx's own copy can't drift from it. */
export const FEE = 500_000_000_000_000n;

function decodedDescription(): ScenarioExplainer {
  return {
    action: "Withdraw a shielded note and swap it",
    changes: "Spends the note's nullifiers, swaps the withdrawn ETH for BONUS tokens, and pays out to this account -- all in one frame transaction",
    risk: "The ZK proof is the only authorization -- generated entirely in this tab from the pasted secret note, never sent anywhere before the transaction itself",
  };
}

/** Builds one `privateSwapScenario` for withdrawing `note`. Returns the scenario object plus a
 *  `getMinOut` getter for the swap's committed minimum output -- `buildFrames` is the only place
 *  that value is known (it falls out of the ZK proof's own public signals), and `onResult`
 *  (owned by PrivateSwap.tsx, per the same "page owns dialogs" split shieldScenario.ts uses) has
 *  no other channel to read it: this scenario has no `prepare` step, so the interface's
 *  `context` channel -- the only thing threaded from a scenario's own work back to `onResult`
 *  -- is never populated. Unlike shieldScenario's module-level cache (needed because that
 *  scenario is one static object reused across every Shield click), a closure suffices here: a
 *  fresh scenario object is built per withdrawal attempt, so there's nothing to reset between
 *  runs. */
export function buildPrivateSwapScenario(
  note: SecretNote,
): { scenario: HegotaWalletScenario; getMinOut(): bigint | null } {
  let minOut: bigint | null = null;

  const scenario: HegotaWalletScenario = {
    id: "private-swap",
    walletTitle: "Withdraw privately",
    // Deliberately no `accountKind`: there is no smart account here either -- the connected
    // account is both the acting account and (per the frame-shape comment above) merely whoever
    // happens to sign the envelope, unrelated to the pool being the frame's real sender.
    decodedDescription,
    buildFrames: async ({ provider, accountAddress }, _quoteResult, _context, _triggerViolation, onProgress) => {
      const finalRecipient = accountAddress;

      await onProgress?.("Syncing the pool's note tree");
      const poolContract = new Contract(POOL, ShieldedPoolABI, provider);
      const synced = await syncTreeFromChain(poolContract, DEPLOY_BLOCK);

      const domain = domainScalar(BigInt(HEGOTA_CHAIN_ID), SOURCE_ID);
      // The slow step -- a real Groth16 proof, generated entirely in this tab (see this file's
      // own header comment on why that's the note's whole authorization).
      await onProgress?.("Generating the withdrawal proof");
      const { spend, nf1, nf2 } = await buildWithdrawSpend(note, synced, domain, EXECUTOR, FEE);

      await onProgress?.("Quoting the swap");
      const swapContract = new Contract(MOCK_SWAP, MockSwapETHABI, provider);
      const rate: bigint = await swapContract.rateNumerator(finalRecipient);
      minOut = (spend.publicAmount * rate) / 1_000_000_000_000_000_000n;

      const ref = await recentRootRef(provider, SOURCE_ID, note.shieldBlockNumber, spend.root);

      await onProgress?.("Building the transaction");
      const withdrawCalldata = poolIface.encodeFunctionData("withdraw", [
        [
          spend.root, spend.domain, spend.nf1, spend.nf2, spend.outCm1, spend.outCm2,
          spend.publicAmount, spend.fee, spend.ctx, spend.pA, spend.pB, spend.pC,
        ],
        EXECUTOR,
      ]);
      // The whole withdrawal is swapped; no re-shielded change note (changeInner is ignored
      // whenever swapAmount === the withdraw's own publicAmount, matching handlePrivateSwap's
      // prior inline call exactly).
      const executeSwapCalldata = executorIface.encodeFunctionData("executeSwap", [
        spend.publicAmount, finalRecipient, hex32(0n),
      ]);
      const assertCalldata = assertionIface.encodeFunctionData("assertPrivateSwap", [
        OUT_TOKEN, finalRecipient, minOut, 0n, EXECUTOR,
      ]);

      return {
        // Pool-as-sender: see this file's header comment. NOT senderAddress -- the connected
        // wallet still signs the envelope (WalletSimulatorPanel always does), but the frame
        // tx's own sender is the pool, exactly as submitPrivateSwap built it before this
        // scenario existed.
        sender: POOL,
        nonceKeys: nf1 < nf2 ? [nf1, nf2] : [nf2, nf1],
        nonceSeq: 0,
        frames: [
          new Frame(FrameMode.VERIFY, 0x03, POOL, 350_000, 0n, new Uint8Array(0)),
          new Frame(FrameMode.SENDER, 0, POOL, 10_000_000, 0n, getBytes(withdrawCalldata)),
          new Frame(FrameMode.DEFAULT, 0, EXECUTOR, 800_000, 0n, getBytes(executeSwapCalldata)),
          new Frame(FrameMode.POST_TX, 0, ASSERTION, 300_000, 0n, getBytes(assertCalldata)),
        ],
        recentRootRefs: [ref],
      };
    },
  };

  return { scenario, getMinOut: () => minOut };
}
