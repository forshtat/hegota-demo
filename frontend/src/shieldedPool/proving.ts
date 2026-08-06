// Client-side Groth16 proof generation for the spend circuit, run entirely in the browser
// (the note's secrets never leave it). Uses snarkjs directly against the circuit assets
// served from frontend/public/circuits/ -- the same wasm/zkey the Python tooling proves
// with (lib/minimal-shielded-pool/build/), just fetched over HTTP instead of from disk.
//
// Proof formatting: rather than manually reassembling snarkjs's raw proof.pi_a/pi_b/pi_c
// into the Solidity calldata shape (a well-known place to get G2's coordinate order wrong),
// this uses snarkjs's own `exportSolidityCallData`, the exact function
// wallet/gen_smoke.py's prove() relies on (via the `snarkjs zkey export soliditycalldata`
// CLI) to build the fixtures already proven working on-chain in Stage 1.

import * as snarkjs from "snarkjs";
import type { CircomWitnessInput } from "./witness.js";

export interface SpendProof {
  pA: [bigint, bigint];
  pB: [[bigint, bigint], [bigint, bigint]];
  pC: [bigint, bigint];
}

const WASM_URL = "/circuits/spend.wasm";
const ZKEY_URL = "/circuits/spend_final.zkey";

/** Public signals in the circuit's own order: [nf1, nf2, outCm1, outCm2, root, domain,
 *  publicAmount, fee, ctx] -- matches ShieldedPoolLogic.verifyProof's nine-signal order. */
export interface ProveResult {
  proof: SpendProof;
  publicSignals: bigint[];
}

export async function proveSpend(witness: CircomWitnessInput): Promise<ProveResult> {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(witness, WASM_URL, ZKEY_URL);

  const callData: string = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const [pA, pB, pC] = JSON.parse(`[${callData}]`) as [string[], string[][], string[]];

  return {
    proof: {
      pA: [BigInt(pA[0]), BigInt(pA[1])],
      pB: [
        [BigInt(pB[0][0]), BigInt(pB[0][1])],
        [BigInt(pB[1][0]), BigInt(pB[1][1])],
      ],
      pC: [BigInt(pC[0]), BigInt(pC[1])],
    },
    publicSignals: publicSignals.map((s: string) => BigInt(s)),
  };
}
