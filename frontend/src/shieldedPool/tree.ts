// TypeScript port of wallet.py's Tree class: a full zero-padded Merkle tree of note
// commitments, matching the pool's own incremental tree. Rebuilds all levels from scratch on
// every root()/authPath() call (like the Python original) -- fine for a browser wallet that
// only ever holds a handful of notes; not meant to scale to the pool's own on-chain size.

import { DEPTH } from "./note.js";
import { p2 } from "./poseidon.js";

export class Tree {
  readonly depth: number;
  leaves: bigint[] = [];
  private zeros: bigint[] = [0n];
  private zerosReady: Promise<void>;

  constructor(depth: number = DEPTH) {
    this.depth = depth;
    this.zerosReady = this.buildZeros();
  }

  private async buildZeros(): Promise<void> {
    for (let i = 0; i < this.depth; i++) {
      this.zeros.push(await p2(this.zeros[this.zeros.length - 1], this.zeros[this.zeros.length - 1]));
    }
  }

  append(cm: bigint): number {
    const idx = this.leaves.length;
    if (idx >= 1 << this.depth) throw new Error("tree full");
    this.leaves.push(cm);
    return idx;
  }

  private async levels(): Promise<bigint[][]> {
    await this.zerosReady;
    let level = this.leaves.length ? [...this.leaves] : [this.zeros[0]];
    const levels: bigint[][] = [level];
    for (let d = 0; d < this.depth; d++) {
      const next: bigint[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : this.zeros[d];
        next.push(await p2(left, right));
      }
      level = next;
      levels.push(level);
    }
    return levels;
  }

  async root(): Promise<bigint> {
    const levels = await this.levels();
    return levels[this.depth][0];
  }

  async authPath(idxIn: number): Promise<{ siblings: bigint[]; bits: number[] }> {
    const levels = await this.levels();
    const siblings: bigint[] = [];
    const bits: number[] = [];
    let idx = idxIn;
    for (let d = 0; d < this.depth; d++) {
      const level = levels[d];
      const sibIdx = idx ^ 1;
      const sib = sibIdx < level.length ? level[sibIdx] : this.zeros[d];
      siblings.push(sib);
      bits.push(idx & 1);
      idx >>= 1;
    }
    return { siblings, bits };
  }
}
