// TypeScript port of lib/minimal-shielded-pool/wallet/wallet.py's note cryptography
// (mirrors contracts/circuits/spend.circom / ShieldedPoolLogic.sol's domainFor). Uses the
// SAME Poseidon (see poseidon.ts) and ethers' keccak256 for the one keccak-based value,
// domain_scalar -- no cryptography is reimplemented here, just the pool's specific formulas.

import { keccak256, getBytes, concat } from "ethers";
import { P, TAG_PK, TAG_LEAF, TAG_NULL, p2, tagged } from "./poseidon.js";

export const DEPTH = 20;
export const MAX_VALUE = 1n << 128n;
// bytes32 constant DOMAIN_TAG from ShieldedPoolLogic.sol.
const DOMAIN_TAG = getBytes("0x40752e102d2a749c61d42a71e297edd3b493de639003b9480a700d589d98065b");

function randFe(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  return x % P;
}

function u256be(x: bigint): Uint8Array {
  const hex = x.toString(16).padStart(64, "0");
  return getBytes("0x" + hex);
}

export async function ownerPk(spendKey: bigint): Promise<bigint> {
  return tagged(TAG_PK, spendKey, 0n);
}

/** What a recipient reveals to be paid: hides owner_pk and rho. */
export async function inner(spendKey: bigint, rho: bigint): Promise<bigint> {
  return p2(await ownerPk(spendKey), rho);
}

export async function commitment(spendKey: bigint, rho: bigint, value: bigint): Promise<bigint> {
  return tagged(TAG_LEAF, await inner(spendKey, rho), value);
}

/** keccak256(DOMAIN_TAG || uint256_be(chainId) || source_id) mod Fr. */
export function domainScalar(chainId: bigint, sourceIdHex: string): bigint {
  const sourceId = getBytes(sourceIdHex);
  if (sourceId.length !== 32) throw new Error("source_id must be 32 bytes");
  const preimage = concat([DOMAIN_TAG, u256be(chainId), sourceId]);
  return BigInt(keccak256(preimage)) % P;
}

export async function nullifier(domain: bigint, spendKey: bigint, cm: bigint): Promise<bigint> {
  return tagged(TAG_NULL, await p2(domain, spendKey), cm);
}

/** Fresh (spendKey, rho); the wallet keeps both secret. */
export function newNote(): { spendKey: bigint; rho: bigint } {
  return { spendKey: randFe(), rho: randFe() };
}

export interface SpendInput {
  sk: bigint;
  rho: bigint;
  value: bigint;
  idx: number | null;
}

/** A zero-value dummy input: fabricated secrets, never in the tree. Its nullifier derives
 *  from its own fabricated cm, so it cannot collide with a real note's, and it contributes
 *  zero to conservation. */
export function dummyInput(): SpendInput {
  const { spendKey, rho } = newNote();
  return { sk: spendKey, rho, value: 0n, idx: null };
}

/** The recipient address as one field element (matches ShieldedPool.ctxFor). */
export function ctxForRecipient(addrHex: string): bigint {
  return BigInt(addrHex);
}
