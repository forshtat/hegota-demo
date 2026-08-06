// TypeScript port of lib/minimal-shielded-pool/reference/poseidon_bn254.py's thin wrapper
// over circomlibjs -- the SAME package the pool's own circuit/contracts pair with (see that
// file's own doc comment), not a reimplementation of the hash itself. `buildPoseidon()` is
// circomlibjs's wasm-backed implementation; `poseidon_bn254.py`'s `_check()` cross-validates
// it against the pure-JS reference on every commit, so trusting it here is the same trust
// the pool's own Python tooling already places in it.

import { buildPoseidon } from "circomlibjs";

export const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// v2 pool tag values (contracts/circuits/spend.circom, mirrored by poseidon_bn254.py).
export const TAG_PK = 1n;
export const TAG_LEAF = 2n;
export const TAG_NULL = 3n;

let poseidonPromise: ReturnType<typeof buildPoseidon> | null = null;
function getPoseidon() {
  if (!poseidonPromise) poseidonPromise = buildPoseidon();
  return poseidonPromise;
}

/** circomlib Poseidon: 2 or 3 field-element inputs, one output, as a bigint. */
export async function poseidon(inputs: bigint[]): Promise<bigint> {
  const pos = await getPoseidon();
  const F = pos.F;
  const result = pos(inputs.map((x) => F.e(x)));
  return BigInt(F.toString(result));
}

export async function p2(a: bigint, b: bigint): Promise<bigint> {
  return poseidon([a, b]);
}

export async function p3(a: bigint, b: bigint, c: bigint): Promise<bigint> {
  return poseidon([a, b, c]);
}

export async function tagged(tag: bigint, a: bigint, b: bigint): Promise<bigint> {
  return poseidon([tag, a, b]);
}

/** Canonical bytes32 encoding: one big-endian field element, matching poseidon_bn254.py's hex32. */
export function hex32(x: bigint): string {
  return "0x" + x.toString(16).padStart(64, "0");
}
