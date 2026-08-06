// TypeScript port of the Ethrex team's reference frame-transaction (type 0x06) encoder,
// fetched from `origin/hegota-devnet:scripts/hegota-devnet/frametx.py`. Wire layout:
//
//   raw = 0x06 || rlp([chain_id, nonce_keys, nonce_seq, sender, frames, signatures,
//                      max_priority_fee, max_fee, max_blob_fee, blob_hashes,
//                      recent_root_references])
//   frame     = rlp([mode, flags, target_or_empty, gas_limit, value, data])
//   signature = rlp([scheme, signer, msg, signature_bytes])  // scheme: 0=ARBITRARY, 1=SECP256K1, 2=P256
//   sig_hash  = keccak256(0x06 || rlp(envelope with empty-msg signatures' bytes elided))
//
// Validated against frametx.py's golden vector — see scripts/verify-frametx-encoding.mjs.

import { keccak256, getBytes } from "ethers";

export const FrameMode = { DEFAULT: 0, VERIFY: 1, SENDER: 2, POST_TX: 3 };
// EIP-8141 signature schemes: ARBITRARY=0, SECP256K1=1, P256=2.
export const SigScheme = { ARBITRARY: 0, SECP256K1: 1, P256: 2 };

// ---------- minimal RLP ----------

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function bigEndianMinimal(x: bigint): Uint8Array {
  if (x < 0n) throw new Error("frametx: negative integers are not supported");
  if (x === 0n) return new Uint8Array(0);
  const bytes: number[] = [];
  let v = x;
  while (v > 0n) {
    bytes.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  return Uint8Array.from(bytes);
}

function rlpBytes(b: Uint8Array): Uint8Array {
  if (b.length === 1 && b[0] < 0x80) return b;
  if (b.length < 56) return concatBytes([Uint8Array.of(0x80 + b.length), b]);
  const lenBytes = bigEndianMinimal(BigInt(b.length));
  return concatBytes([Uint8Array.of(0xb7 + lenBytes.length), lenBytes, b]);
}

function rlpList(items: Uint8Array[]): Uint8Array {
  const body = concatBytes(items);
  if (body.length < 56) return concatBytes([Uint8Array.of(0xc0 + body.length), body]);
  const lenBytes = bigEndianMinimal(BigInt(body.length));
  return concatBytes([Uint8Array.of(0xf7 + lenBytes.length), lenBytes, body]);
}

function rlpInt(x: bigint | number): Uint8Array {
  return rlpBytes(bigEndianMinimal(BigInt(x)));
}

function addr20(a: string | bigint): Uint8Array {
  const hex = (typeof a === "bigint" ? a.toString(16) : a.replace(/^0x/i, "")).padStart(40, "0");
  const out = new Uint8Array(20);
  for (let i = 0; i < 20; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ---------- frame-tx model ----------

export class Frame {
  mode: number;
  flags: number;
  target: string | bigint | null; // null => empty target field (e.g. VERIFY(self) uses target=sender instead)
  gasLimit: bigint | number;
  value: bigint | number;
  data: Uint8Array;

  constructor(
    mode: number,
    flags: number,
    target: string | bigint | null,
    gasLimit: bigint | number,
    value: bigint | number,
    data: Uint8Array,
  ) {
    this.mode = mode;
    this.flags = flags;
    this.target = target;
    this.gasLimit = gasLimit;
    this.value = value;
    this.data = data;
  }

  rlp(): Uint8Array {
    const tgt = this.target !== null ? rlpBytes(addr20(this.target)) : rlpBytes(new Uint8Array(0));
    return rlpList([
      rlpInt(this.mode),
      rlpInt(this.flags),
      tgt,
      rlpInt(this.gasLimit),
      rlpInt(this.value),
      rlpBytes(this.data),
    ]);
  }
}

export class FrameSig {
  scheme: number;
  signer: string | bigint;
  msg: Uint8Array;
  signature: Uint8Array;

  constructor(scheme: number, signer: string | bigint, msg: Uint8Array, signature: Uint8Array) {
    this.scheme = scheme;
    this.signer = signer;
    this.msg = msg;
    this.signature = signature;
  }

  rlp(elide = false): Uint8Array {
    const sig = elide && this.msg.length === 0 ? new Uint8Array(0) : this.signature;
    return rlpList([rlpInt(this.scheme), rlpBytes(addr20(this.signer)), rlpBytes(this.msg), rlpBytes(sig)]);
  }
}

export interface FrameTxOptions {
  chainId: bigint | number;
  nonceKeys: (bigint | number)[];
  nonceSeq: bigint | number;
  sender: string | bigint;
  frames: Frame[];
  signatures: FrameSig[];
  maxPriorityFee: bigint | number;
  maxFee: bigint | number;
  maxBlobFee?: bigint | number;
  blobHashes?: Uint8Array[];
  recentRootRefs?: Uint8Array[]; // pre-encoded [source_id, slot, root] tuples; unused by this demo
}

export class FrameTx {
  chainId: bigint | number;
  nonceKeys: (bigint | number)[];
  nonceSeq: bigint | number;
  sender: string | bigint;
  frames: Frame[];
  signatures: FrameSig[];
  maxPriorityFee: bigint | number;
  maxFee: bigint | number;
  maxBlobFee: bigint | number;
  blobHashes: Uint8Array[];
  recentRootRefs: Uint8Array[];

  constructor(opts: FrameTxOptions) {
    this.chainId = opts.chainId;
    this.nonceKeys = opts.nonceKeys;
    this.nonceSeq = opts.nonceSeq;
    this.sender = opts.sender;
    this.frames = opts.frames;
    this.signatures = opts.signatures;
    this.maxPriorityFee = opts.maxPriorityFee;
    this.maxFee = opts.maxFee;
    this.maxBlobFee = opts.maxBlobFee ?? 0;
    this.blobHashes = opts.blobHashes ?? [];
    this.recentRootRefs = opts.recentRootRefs ?? [];
  }

  private envelope(elideSigs: boolean): Uint8Array[] {
    return [
      rlpInt(this.chainId),
      rlpList(this.nonceKeys.map((k) => rlpInt(k))),
      rlpInt(this.nonceSeq),
      rlpBytes(addr20(this.sender)),
      rlpList(this.frames.map((f) => f.rlp())),
      rlpList(this.signatures.map((s) => s.rlp(elideSigs))),
      rlpInt(this.maxPriorityFee),
      rlpInt(this.maxFee),
      rlpInt(this.maxBlobFee),
      rlpList(this.blobHashes.map((h) => rlpBytes(h))),
      rlpList(this.recentRootRefs),
    ];
  }

  encode(): Uint8Array {
    return rlpList(this.envelope(false));
  }

  raw(): Uint8Array {
    return concatBytes([Uint8Array.of(0x06), this.encode()]);
  }

  /** keccak256(0x06 || rlp(envelope)) with every empty-msg signature's bytes elided — this is what gets signed. */
  sigHash(): Uint8Array {
    const preimage = concatBytes([Uint8Array.of(0x06), rlpList(this.envelope(true))]);
    return getBytes(keccak256(preimage));
  }
}

export function hex(bytes: Uint8Array): string {
  return "0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Packs an ethers Signature-shaped {yParity, r, s} into the 65-byte [yParity(1) || r(32) ||
 *  s(32)] layout EIP-8141's SECP256K1 FrameSig expects -- note this is NOT the legacy Ethereum
 *  v||r||s layout (v = 27/28); yParity comes first and is 0/1. */
export function packFrameSignature(sig: { yParity: number; r: string; s: string }): Uint8Array {
  const bytes = new Uint8Array(65);
  bytes[0] = sig.yParity;
  bytes.set(getBytes(sig.r), 1);
  bytes.set(getBytes(sig.s), 33);
  return bytes;
}

// Exported for the standalone golden-vector check (scripts/verify-frametx-encoding.mjs).
export const _internal = { rlpBytes, rlpList, rlpInt, addr20, concatBytes, bigEndianMinimal };
