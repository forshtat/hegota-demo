// TypeScript port of wallet.py's build_witness: the circom input map for a join-split
// spend, proven client-side against the committed circuit (see proving.ts).

import { MAX_VALUE } from "./note.js";
import type { Tree } from "./tree.js";
import { ctxForRecipient } from "./note.js";
import type { SpendInput } from "./note.js";

export interface CircomWitnessInput {
  root: string;
  domain: string;
  in_spend_key: string[];
  in_rho: string[];
  in_value: string[];
  in_siblings: string[][];
  in_bits: string[][];
  out_inner: string[];
  out_value: string[];
  public_amount: string;
  fee: string;
  ctx: string;
}

/** inputs: exactly two SpendInputs (idx null for a dummy, which must have value 0). outputs:
 *  exactly two (inner, value) pairs. Values must conserve:
 *  sum(in) == sum(out) + publicAmount + fee. */
export async function buildWitness(
  tree: Tree,
  inputs: [SpendInput, SpendInput],
  outputs: [[bigint, bigint], [bigint, bigint]],
  domain: bigint,
  publicAmount: bigint = 0n,
  fee: bigint = 0n,
  recipient?: string,
): Promise<CircomWitnessInput> {
  const totalIn = inputs[0].value + inputs[1].value;
  const totalOut = outputs[0][1] + outputs[1][1] + publicAmount + fee;
  if (totalIn !== totalOut) throw new Error(`not conserved: ${totalIn} != ${totalOut}`);
  for (const v of [publicAmount, fee, inputs[0].value, inputs[1].value, outputs[0][1], outputs[1][1]]) {
    if (v < 0n || v >= MAX_VALUE) throw new Error(`value out of range: ${v}`);
  }
  for (const i of inputs) {
    if (i.idx === null && i.value !== 0n) throw new Error("a dummy input must have value 0");
  }

  const ctx = recipient !== undefined ? ctxForRecipient(recipient) : 0n;

  const sibs: bigint[][] = [];
  const bits: number[][] = [];
  for (const i of inputs) {
    if (i.idx === null) {
      sibs.push(new Array(tree.depth).fill(0n));
      bits.push(new Array(tree.depth).fill(0));
    } else {
      const { siblings, bits: b } = await tree.authPath(i.idx);
      sibs.push(siblings);
      bits.push(b);
    }
  }

  return {
    root: (await tree.root()).toString(),
    domain: domain.toString(),
    in_spend_key: inputs.map((i) => i.sk.toString()),
    in_rho: inputs.map((i) => i.rho.toString()),
    in_value: inputs.map((i) => i.value.toString()),
    in_siblings: sibs.map((s) => s.map((x) => x.toString())),
    in_bits: bits.map((b) => b.map((x) => x.toString())),
    out_inner: outputs.map(([inn]) => inn.toString()),
    out_value: outputs.map(([, v]) => v.toString()),
    public_amount: publicAmount.toString(),
    fee: fee.toString(),
    ctx: ctx.toString(),
  };
}
