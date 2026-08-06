// Rebuilds the pool's Merkle tree client-side from on-chain LeafAppended events. The pool
// is a shared singleton on a public devnet -- unlike wallet.py's fixture-driven tests (which
// control the whole leaf history themselves), a browser wallet must sync whatever leaves
// already exist (from other demo runs) before it can compute a correct auth path for its
// own note.

import type { Contract } from "ethers";
import { Tree } from "./tree.js";
import { DEPTH } from "./note.js";

export interface SyncedTree {
  tree: Tree;
  /** cm -> leaf index, for locating a just-shielded note's position. */
  indexOf: Map<string, number>;
}

/** Scans every LeafAppended(bytes32 indexed cm, uint32 index, bytes32 newRoot, uint64 slot)
 *  event from `fromBlock` to `latest` and replays them into a fresh Tree in order. */
export async function syncTreeFromChain(pool: Contract, fromBlock: number): Promise<SyncedTree> {
  const tree = new Tree(DEPTH);
  const indexOf = new Map<string, number>();

  const filter = pool.filters.LeafAppended();
  const events = await pool.queryFilter(filter, fromBlock, "latest");
  // queryFilter results are already in ascending (blockNumber, logIndex) order.
  for (const event of events) {
    const args = "args" in event ? event.args : undefined;
    if (!args) continue;
    const cm = BigInt(args.cm as string);
    const idx = tree.append(cm);
    indexOf.set(cm.toString(), idx);
  }
  return { tree, indexOf };
}
