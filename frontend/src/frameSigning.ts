// Generic EIP-8141 frame-transaction signing and preview helpers -- promoted out of
// shieldedPool/privateSwapTx.ts because none of this is actually shielded-pool-specific: it
// operates purely on the generic Frame/FrameTx classes from frametx.ts and the generic
// SigningRequestPreview shapes from signingPreview.ts. Every scenario that builds and signs a
// real frame transaction (shielded-pool flows today; the wallet-simulator attack scenarios once
// they migrate to the same pipeline) shares this module rather than each re-deriving its own
// copy.

import { formatEther, type BrowserProvider, type Interface, type ParamType } from "ethers";
import { FrameMode, hex, type FrameTx } from "./frametx.js";
import { connectRelayWallet, hegotaAddress } from "./hegotaWallet.js";
import { signAutoWalletDigest } from "./devAutoWallet.js";
import type { CuratedRow, DecodedArg, DecodedCall, FrameTxSigningRequestPreview } from "./signingPreview.js";

/** Whoever produces the frame tx's outer envelope signature. Real wallets (MetaMask etc.) can't
 *  produce this raw-digest signature at all, so `relaySigner` is the only option there --
 *  sender/gas/signature all stay the relay's. The embedded dev wallet CAN sign a raw digest with
 *  its own key (we fully control its keys), so `autoWalletSigner` lets the connected account
 *  genuinely be the one submitting.
 *
 *  Takes the unsigned FrameTx itself, not a caller-computed digest -- the digest is still what
 *  ultimately gets signed (every ECDSA signature signs a fixed-size hash, there's no way around
 *  that), but deriving it is the signer's own job now, the same way ethers' own
 *  Wallet.signTransaction() takes a transaction object rather than being handed a bare hash. */
export interface FrameSigner {
  address: string;
  sign(tx: FrameTx): Promise<{ yParity: number; r: string; s: string }>;
}

export function relaySigner(provider: BrowserProvider): FrameSigner {
  const relay = connectRelayWallet(provider);
  return {
    address: hegotaAddress(),
    sign: (tx) => Promise.resolve(relay.signingKey.sign(tx.sigHash())),
  };
}

export function autoWalletSigner(address: string): FrameSigner {
  return {
    address,
    sign: (tx) => Promise.resolve(signAutoWalletDigest(tx.sigHash())),
  };
}

const FRAME_MODE_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(FrameMode).map(([name, value]) => [value, name]),
);

// Static, protocol-level description of what each *mode* structurally means -- true of the
// mode itself regardless of which specific call it carries, so unlike per-call descriptions
// these are safe to hardcode: they can't drift out of sync with what a given transaction does.
const FRAME_MODE_GLOSS: Record<number, string> = {
  [FrameMode.DEFAULT]: "An ordinary call",
};

export function short(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Turns one ABI-typed value into a flat, one-line, human-readable DecodedArg -- driven
 *  entirely by real ABI metadata (ParamType.baseType/.name), never by which specific function
 *  this happens to be, so it can't drift into hand-authored-per-function territory. `depth`
 *  caps tuple/array recursion at one level: DeviceScreen (the drawer's device-screen chrome)
 *  has a fixed height and never scrolls, so a 12-field struct like the withdraw call's Spend
 *  argument must summarize to one line, not explode into 12 more. Amounts are ETH-formatted
 *  only when the ABI parameter's own name suggests a value (amount/fee/value) -- everything
 *  else (roots, nullifiers, proof points) is cryptographic material with no human meaning, so
 *  it's shown as shortened hex or counted, never mistaken for money. */
function formatDecodedValue(param: ParamType, value: unknown, depth: number): DecodedArg {
  const name = param.name || param.type;
  if (param.baseType === "tuple" && param.components) {
    if (depth >= 1) {
      return { name, type: param.type, display: `{${param.components.length} fields}` };
    }
    const values = value as ArrayLike<unknown>;
    const parts = param.components.map((c, i) => formatDecodedValue(c, values[i], depth + 1));
    const meaningful = parts.filter((p) => p.display.endsWith(" ETH"));
    const restCount = parts.length - meaningful.length;
    const meaningfulText = meaningful.map((p) => `${p.name}: ${p.display}`).join(", ");
    const restText =
      restCount > 0 ? `${meaningful.length ? " + " : ""}${restCount} more field${restCount === 1 ? "" : "s"}` : "";
    return { name, type: param.type, display: `{${meaningfulText}${restText}}` };
  }
  if (param.baseType === "array" && param.arrayChildren) {
    const values = value as unknown[];
    return { name, type: param.type, display: `[${values.length} item${values.length === 1 ? "" : "s"}]` };
  }
  if (param.baseType === "address") {
    return { name, type: param.type, display: short(value as string) };
  }
  if (param.baseType.startsWith("uint") || param.baseType.startsWith("int")) {
    const v = value as bigint;
    if (/amount|fee|value/i.test(param.name)) {
      return { name, type: param.type, display: `${formatEther(v)} ETH` };
    }
    return { name, type: param.type, display: v.toString() };
  }
  if (param.baseType === "bytes32" || param.baseType.startsWith("bytes")) {
    const v = value as string;
    return { name, type: param.type, display: v.length > 20 ? `${v.slice(0, 10)}…${v.slice(-6)}` : v };
  }
  return { name, type: param.type, display: String(value) };
}

/** ABIs this app knows how to decode frame calldata against -- populated by whichever module
 *  defines its own scenario-specific interfaces (shieldedPool/privateSwapTx.ts registers its
 *  pool/executor/assertion ABIs at module load; future scenario files do the same), mirroring
 *  the curated-row registry below. Keeps this module itself free of any scenario-specific ABI
 *  knowledge -- decodeFrameData was shielded-pool-specific only by accident of where it used to
 *  live, not by anything it actually does. */
const KNOWN_IFACES: Interface[] = [];

export function registerKnownInterface(iface: Interface): void {
  KNOWN_IFACES.push(iface);
}

/** Decodes a single frame's calldata against this app's own known ABIs (every Interface
 *  registered via registerKnownInterface above), falling back to null (raw hex only) if
 *  nothing matches -- e.g. a VERIFY frame's empty data, or a genuinely unrecognized call. */
function decodeFrameData(dataHex: string): DecodedCall | null {
  if (dataHex === "0x") return null;
  for (const iface of KNOWN_IFACES) {
    const parsed = iface.parseTransaction({ data: dataHex });
    if (parsed) {
      return {
        functionName: parsed.name,
        args: parsed.fragment.inputs.map((param, i) => formatDecodedValue(param, parsed.args[i], 0)),
      };
    }
  }
  return null;
}

/** Curated rows for the frame screen -- built by whichever module registers a builder for a
 *  given function name via registerCuratedRows, the same "pick what matters, from real data"
 *  pattern every attack scenario's formatEnforcementText already uses (see EnforcementRow.tsx),
 *  and the same registry shape as registerEnsName/registerToken (ensLabels.ts,
 *  hegotaScenarios/tokenLabels.ts). Falls back to null for a function nothing has registered a
 *  builder for -- describeFrameTx then falls back to the generic decoded-args dump
 *  (decodeFrameData above) instead. */
// Returning null is how a registered builder declines a *particular* call it can't summarize
// (the attack scenarios' shared PostTxExecutor.executeAction builder does this for an inner
// action no scenario has registered rows for) -- describeFrameTx then falls back to the generic
// decoded-args dump, exactly as it does for a function with no builder at all.
type CuratedRowsBuilder = (dataHex: string, frameValue: bigint) => CuratedRow[] | null;
const CURATED_BUILDERS: Record<string, CuratedRowsBuilder> = {};

export function registerCuratedRows(functionName: string, builder: CuratedRowsBuilder): void {
  CURATED_BUILDERS[functionName] = builder;
}

export function curatedFrameRows(functionName: string, dataHex: string, frameValue: bigint): CuratedRow[] | null {
  return CURATED_BUILDERS[functionName]?.(dataHex, frameValue) ?? null;
}

/** Builds the drawer's preview of an unsigned FrameTx by decoding it directly -- every field
 *  shown here comes from the real object about to be signed, not a hand-authored description
 *  that could drift from what the object actually contains. */
export function describeFrameTx(tx: FrameTx): FrameTxSigningRequestPreview {
  return {
    chainId: Number(tx.chainId),
    sender: typeof tx.sender === "string" ? tx.sender : "0x" + tx.sender.toString(16),
    digestHex: hex(tx.sigHash()),
    frames: tx.frames.map((frame) => {
      const dataHex = hex(frame.data);
      const decoded = decodeFrameData(dataHex);
      return {
        mode: FRAME_MODE_NAMES[frame.mode] ?? `mode ${frame.mode}`,
        modeGloss: FRAME_MODE_GLOSS[frame.mode] ?? "",
        target:
          frame.target === null
            ? null
            : typeof frame.target === "string"
              ? frame.target
              : "0x" + frame.target.toString(16),
        gasLimit: frame.gasLimit.toString(),
        value: frame.value.toString(),
        dataHex,
        decoded,
        curatedRows: decoded ? curatedFrameRows(decoded.functionName, dataHex, BigInt(frame.value)) : null,
      };
    }),
  };
}

/** Wraps a FrameSigner so producing its signature first blocks on drawer approval -- without
 *  this, autoWalletSigner's raw-digest signature (the withdrawer's OWN key, per its own doc
 *  comment above) gets produced the instant sign() is called, with nothing shown in the
 *  wallet-simulator drawer at all. Only meant for autoWalletSigner -- relaySigner isn't a
 *  "wallet" in this metaphor, it's app-side plumbing with no one to ask. */
export function withFrameTxApproval(
  base: FrameSigner,
  requestFrameTxSignature: (preview: FrameTxSigningRequestPreview) => Promise<void>,
): FrameSigner {
  return {
    address: base.address,
    async sign(tx) {
      await requestFrameTxSignature(describeFrameTx(tx));
      return base.sign(tx);
    },
  };
}

/** Every self-verify scenario (VERIFY(self) as frame[0], sender = the connected account itself)
 *  needs this exact lookup before building its FrameTxPlan -- written once here rather than
 *  duplicated inline in every scenario. */
export async function fetchSelfVerifyNonce(provider: BrowserProvider, address: string): Promise<bigint> {
  const nonce = await provider.send("eth_getTransactionCount", [address, "latest"]);
  return BigInt(nonce);
}
