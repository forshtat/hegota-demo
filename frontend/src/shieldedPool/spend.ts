// High-level orchestration: turn a stored note into a withdraw Spend struct + Groth16 proof,
// ready to pass as ShieldedPoolLogic.withdraw(Spend, recipient)'s first argument. Mirrors
// wallet/gen_smoke.py's withdraw-entry construction (a real note plus a dummy input, two
// zero-value outputs, publicAmount = value - fee), but withdraws the shielded note directly
// (no intermediate join-split "transfer" step) -- simpler, and just as valid a use of the
// pool: transfer exists to break the link between depositor and recipient across two
// separate spends, which this demo's single-user flow doesn't need.

import { commitment, dummyInput, inner, newNote } from "./note.js";
import type { SpendInput } from "./note.js";
import { buildWitness } from "./witness.js";
import { proveSpend } from "./proving.js";
import type { SyncedTree } from "./syncTree.js";
import { hex32 } from "./poseidon.js";
import type { SecretNote } from "./noteTicket.js";

export interface SolSpend {
  root: string;
  domain: string;
  nf1: string;
  nf2: string;
  outCm1: string;
  outCm2: string;
  publicAmount: bigint;
  fee: bigint;
  ctx: string;
  pA: [bigint, bigint];
  pB: [[bigint, bigint], [bigint, bigint]];
  pC: [bigint, bigint];
}

/** Builds and proves a withdraw of `note` (its full value minus `fee`) to `recipient`.
 *  Returns the Solidity-ready Spend struct alongside the raw nullifiers (needed to set the
 *  frame transaction's nonce_keys). */
export async function buildWithdrawSpend(
  note: SecretNote,
  synced: SyncedTree,
  domain: bigint,
  recipient: string,
  fee: bigint,
): Promise<{ spend: SolSpend; nf1: bigint; nf2: bigint }> {
  const spendKey = BigInt(note.spendKey);
  const rho = BigInt(note.rho);
  const value = BigInt(note.value);
  const cm = await commitment(spendKey, rho, value);

  const idx = synced.indexOf.get(cm.toString());
  if (idx === undefined) {
    throw new Error("note's commitment not found in the synced tree -- has the shield tx been mined and indexed?");
  }

  const realInput: SpendInput = { sk: spendKey, rho, value, idx };
  const dummy = dummyInput();
  const inputs: [SpendInput, SpendInput] = [realInput, dummy];

  const publicAmount = value - fee;
  if (publicAmount <= 0n) throw new Error("fee exceeds the note's value");

  // Two zero-value outputs -- the withdraw consumes the note entirely, no change note here
  // (PrivateSwapExecutor.executeSwap handles "change" at the ETH level after the swap).
  const outA = newNote();
  const outB = newNote();
  const outInnerA = await inner(outA.spendKey, outA.rho);
  const outInnerB = await inner(outB.spendKey, outB.rho);
  const outputs: [[bigint, bigint], [bigint, bigint]] = [
    [outInnerA, 0n],
    [outInnerB, 0n],
  ];

  const witness = await buildWitness(synced.tree, inputs, outputs, domain, publicAmount, fee, recipient);
  const { proof, publicSignals } = await proveSpend(witness);

  // Public signal order (ShieldedPoolLogic.verifyProof / gen_smoke.py's spend_entry
  // assertion): [nf1, nf2, outCm1, outCm2, root, domain, publicAmount, fee, ctx].
  const [nf1, nf2, outCm1, outCm2, root, domainOut, publicAmountOut, feeOut, ctx] = publicSignals;
  if (publicAmountOut !== publicAmount || feeOut !== fee || domainOut !== domain) {
    throw new Error("proof public signals do not match the requested witness");
  }

  return {
    spend: {
      root: hex32(root),
      domain: hex32(domainOut),
      nf1: hex32(nf1),
      nf2: hex32(nf2),
      outCm1: hex32(outCm1),
      outCm2: hex32(outCm2),
      publicAmount,
      fee,
      ctx: hex32(ctx),
      pA: proof.pA,
      pB: proof.pB,
      pC: proof.pC,
    },
    nf1,
    nf2,
  };
}

