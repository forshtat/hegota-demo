// Curated-row registrations, the EIP-8272 recent-root reference derivation, and the withdrawal
// receipt-effects decoder for the private-swap demo. The transaction itself -- a real EIP-8141
// type-0x06 frame transaction with the pool as `tx.sender` (the "pool-as-sender" design --
// ShieldedPoolLogic.sol's own doc comment) -- is built by privateSwapScenario.ts's own
// buildFrames; this file no longer submits anything itself.

import { getBytes, formatEther, keccak256, Contract, Interface, type BrowserProvider, type LogDescription } from "ethers";
import { _internal } from "../frametx.js";
import type { CuratedRow } from "../signingPreview.js";
import { ShieldedPoolABI, PrivateSwapExecutorABI, PrivateSwapAssertionABI, MockERC20ABI } from "../contracts/abis.js";
import { registerEnsName, resolveEnsName } from "../ensLabels.js";
import { registerToken, formatTokenAmount } from "../hegotaScenarios/tokenLabels.js";
import { registerCuratedRows, registerKnownInterface, short } from "../frameSigning.js";

const OUT_TOKEN = import.meta.env.VITE_HEGOTA_PRIVATE_SWAP_OUT_TOKEN ?? "";
registerToken(OUT_TOKEN, { symbol: "BONUS", decimals: 18 });

// Read from the env var the deploy script itself writes, not a hardcoded address -- a
// redeploy that changes VITE_HEGOTA_POOL changes what gets registered here too, automatically,
// the next time this module loads (a page refresh), with nothing to update by hand.
const POOL = import.meta.env.VITE_HEGOTA_POOL ?? "";
registerEnsName(POOL, "shielded-pool.eth");

const { rlpBytes, rlpInt, rlpList } = _internal;

// Exported so shieldScenario.ts encodes its `shield` call against the very same Interface whose
// registration below is what lets describeFrameTx name that call at all -- and so importing it
// from there guarantees this module (and every registration in it) is loaded alongside.
export const poolIface = new Interface(ShieldedPoolABI);
// Exported alongside poolIface -- privateSwapScenario.ts encodes executeSwap/assertPrivateSwap
// calldata against these same two Interfaces.
export const executorIface = new Interface(PrivateSwapExecutorABI);
export const assertionIface = new Interface(PrivateSwapAssertionABI);
const erc20Iface = new Interface(MockERC20ABI);

registerKnownInterface(poolIface);
registerKnownInterface(executorIface);
registerKnownInterface(assertionIface);

// Curated rows for the frame screen -- decodes the specific named fields each known function
// actually needs shown, the same "pick what matters, from real data" pattern every attack
// scenario's formatEnforcementText already uses (see EnforcementRow.tsx). Registered with
// frameSigning.ts's shared registry (describeFrameTx falls back to its generic decoded-args
// dump for any function nothing here has registered a builder for -- VERIFY's empty calldata,
// or a genuinely unrecognized call).
//
// The `shield` row lives in shieldScenario.ts now, alongside the scenario that actually builds
// that frame -- same one-builder-per-function-name rule, just registered by the module that owns
// the flow rather than by this one.
registerCuratedRows("withdraw", (dataHex): CuratedRow[] => {
  const [spend] = poolIface.decodeFunctionData("withdraw", dataHex);
  return [
    { label: "Withdrawing", value: `${formatEther(spend.publicAmount)} ETH` },
    { label: "Fee", value: `${formatEther(spend.fee)} ETH` },
  ];
});
registerCuratedRows("executeSwap", (dataHex): CuratedRow[] => {
  const [swapAmount, recipient] = executorIface.decodeFunctionData("executeSwap", dataHex);
  return [
    { label: "Swap amount", value: `${formatEther(swapAmount)} ETH` },
    { label: "Recipient", value: resolveEnsName(recipient) ?? short(recipient) },
  ];
});
registerCuratedRows("assertPrivateSwap", (dataHex): CuratedRow[] => {
  const [outToken, recipient, minOutAmount] = assertionIface.decodeFunctionData("assertPrivateSwap", dataHex);
  return [
    { label: "Minimum received", value: formatTokenAmount(outToken, minOutAmount) },
    { label: "Recipient", value: resolveEnsName(recipient) ?? short(recipient) },
  ];
});

/** Derives the EIP-8272 recent-root reference for a root published at `publishBlock`, and
 *  confirms the RECENT_ROOT_ADDRESS predeploy actually committed it -- mirrors
 *  devnet/pool_frametx.py's recent_root_ref self-check (a wrong slot fails loudly here
 *  instead of producing an unadmittable transaction). Exported so privateSwapScenario.ts can
 *  build the same reference inside its own buildFrames. */
export async function recentRootRef(
  provider: BrowserProvider,
  sourceIdHex: string,
  publishBlock: number,
  rootHex: string,
): Promise<Uint8Array> {
  const RECENT_ROOT_ADDRESS = "0x0000000000000000000000000000000000008272";
  const RECENT_ROOT_LENGTH = 8192n;
  const SECONDS_PER_SLOT = 6n;

  const [publishedBlock, genesisBlock] = await Promise.all([
    provider.send("eth_getBlockByNumber", [hex32Block(publishBlock), false]),
    provider.send("eth_getBlockByNumber", ["0x0", false]),
  ]);
  const ts = BigInt(publishedBlock.timestamp);
  const genesisTs = BigInt(genesisBlock.timestamp);
  const slot = (ts - genesisTs) / SECONDS_PER_SLOT;

  const sourceId = getBytes(sourceIdHex);
  const root = getBytes(rootHex);
  const entryTag = getBytes(keccak256(utf8("RECENT_ROOT_ENTRY")));
  const storageTag = getBytes(keccak256(utf8("RECENT_ROOT_STORAGE")));

  const entryHash = keccak256(concatHex([entryTag, sourceId, u64be(slot), root]));
  const storageKey = keccak256(concatHex([storageTag, sourceId, u64be(slot % RECENT_ROOT_LENGTH)]));
  const stored: string = await provider.send("eth_getStorageAt", [RECENT_ROOT_ADDRESS, storageKey, "latest"]);
  if (BigInt(stored) !== BigInt(entryHash)) {
    throw new Error(
      `recent-root reference self-check failed: derived slot ${slot} for block ${publishBlock} has no committed entry`,
    );
  }

  return rlpList([rlpBytes(sourceId), rlpInt(slot), rlpBytes(root)]);
}

function hex32Block(n: number): string {
  return "0x" + n.toString(16);
}
function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
function u64be(x: bigint): Uint8Array {
  return getBytes("0x" + x.toString(16).padStart(16, "0"));
}
function concatHex(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Turns one pool event log into a plain sentence -- covers every event ShieldedPoolLogic.sol
 *  emits (LeafAppended/NoteSpent/Withdrawn/FeePaid/WithdrawalCredited/FeeCredited), falling
 *  back to the bare event name for anything added later that this hasn't been taught yet. */
function formatPoolEvent(log: LogDescription): string {
  switch (log.name) {
    case "Withdrawn": {
      const [recipient, amount] = log.args as unknown as [string, bigint];
      return `Withdrawn ${formatEther(amount)} ETH from the pool → ${short(recipient)}`;
    }
    case "WithdrawalCredited": {
      const [recipient, amount] = log.args as unknown as [string, bigint];
      return `Credited ${formatEther(amount)} ETH to ${short(recipient)}`;
    }
    case "FeePaid": {
      const [recipient, amount] = log.args as unknown as [string, bigint];
      return `Fee of ${formatEther(amount)} ETH paid to ${short(recipient)}`;
    }
    case "FeeCredited": {
      const [recipient, amount] = log.args as unknown as [string, bigint];
      return `Fee of ${formatEther(amount)} ETH credited to ${short(recipient)}`;
    }
    case "NoteSpent":
      return "Nullifier spent — this note can never be withdrawn again";
    case "LeafAppended":
      return "New note leaf appended to the tree";
    default:
      return log.name;
  }
}

/** Decodes a withdrawal's real on-chain effects from its receipt's logs -- ground truth of
 *  what actually happened (pool events plus any ERC-20 Transfer, e.g. the swap's real payout),
 *  not the amounts this app merely requested. Symbol lookups are cached per token address
 *  within one call since a receipt can contain multiple Transfer logs for the same token. */
export async function decodeReceiptEffects(
  provider: BrowserProvider,
  receipt: Record<string, unknown>,
): Promise<string[]> {
  const logs = (receipt.logs as { address: string; topics: string[]; data: string }[] | undefined) ?? [];
  const effects: string[] = [];
  const symbolCache = new Map<string, string>();

  async function symbolFor(address: string): Promise<string> {
    const key = address.toLowerCase();
    const cached = symbolCache.get(key);
    if (cached) return cached;
    const token = new Contract(address, MockERC20ABI, provider);
    const sym: string = await token.symbol();
    symbolCache.set(key, sym);
    return sym;
  }

  for (const log of logs) {
    const poolLog = poolIface.parseLog(log);
    if (poolLog) {
      effects.push(formatPoolEvent(poolLog));
      continue;
    }
    const erc20Log = erc20Iface.parseLog(log);
    if (erc20Log && erc20Log.name === "Transfer") {
      const [from, to, value] = erc20Log.args as unknown as [string, string, bigint];
      const symbol = await symbolFor(log.address);
      effects.push(`Transfer: ${short(from)} → ${short(to)}: ${formatEther(value)} ${symbol}`);
    }
  }
  return effects;
}
