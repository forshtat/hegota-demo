// Relay-key signer for the Hegotá POST_TX-assertion demo.
//
// EIP-8141 type-0x06 frame transactions require a raw secp256k1 signature over a bare
// 32-byte digest (sigHash()) for the VERIFY frame. MetaMask has no standard JSON-RPC
// method that produces that: personal_sign prepends the EIP-191 prefix (a different
// digest), eth_signTypedData_v4 produces a structurally different EIP-712 hash, and
// eth_sign (true raw-digest signing) is deprecated/hidden in modern MetaMask. So this
// module still holds a dedicated relay/demo key directly (mirroring the Ethrex team's
// own `frametx_submit.py` reference script) purely to produce that one signature and to
// act as the frame tx's `sender` (it pays gas) — every other interaction (reads,
// nonce/fee lookups, and submitting the signed raw tx) goes through the caller-supplied
// MetaMask-connected provider from `useWallet()`, not a standalone RPC client.
//
// SECURITY: Vite inlines VITE_* env vars into the client-side bundle at build time, so
// this private key is publicly visible to anyone who loads the page. That is only
// acceptable because Hegotá is a valueless public testnet funded via a faucet
// (https://faucet.hegota.ethrex.xyz) — never reuse this pattern with a key holding
// real funds.

import { Wallet, type BrowserProvider } from "ethers";
import { Frame, FrameMode, FrameSig, FrameTx, SigScheme, hex, packFrameSignature } from "./frametx.js";
import type { FrameSigner } from "./frameSigning.js";

export const HEGOTA_CHAIN_ID = parseInt(import.meta.env.VITE_HEGOTA_CHAIN_ID ?? "3151908");
const PRIVATE_KEY = import.meta.env.VITE_HEGOTA_PRIVATE_KEY ?? "";
export const HEGOTA_TEST_SUBJECT = import.meta.env.VITE_HEGOTA_TEST_SUBJECT ?? "";

// No provider attached: this wallet only ever produces a raw digest signature and
// reports its own address — it never sends anything itself.
let wallet: Wallet | null = null;
function getWallet(): Wallet {
  if (!wallet) {
    if (!PRIVATE_KEY) {
      throw new Error(
        "Hegotá relay wallet is not configured (VITE_HEGOTA_PRIVATE_KEY is missing from this build) " +
          "-- account provisioning, faucet-adjacent actions, and every frame-tx demo need it. " +
          "If you're seeing this on the deployed site, the site operator needs to set " +
          "VITE_HEGOTA_PRIVATE_KEY as a Cloudflare Workers Builds environment variable and redeploy.",
      );
    }
    wallet = new Wallet(PRIVATE_KEY);
  }
  return wallet;
}

export function hegotaAddress(): string {
  return getWallet().address;
}

/** Connects the relay wallet to a caller-supplied provider so it can sponsor plain
 *  (non-frame) transactions, e.g. one-time ERC-7579 account provisioning. */
export function connectRelayWallet(provider: BrowserProvider): Wallet {
  return getWallet().connect(provider);
}

/** Hegotá's fee-suggestion RPCs (eth_gasPrice / eth_maxPriorityFeePerGas) return a flat
 *  ~1 gwei that has nothing to do with the actual base fee (observed ~7 wei) -- ethers'
 *  automatic fee estimation trusts that suggestion, so an un-overridden sendTransaction on
 *  a multi-million-gas call (e.g. CREATE2 account provisioning) can overpay by ~6 orders of
 *  magnitude relative to what the chain actually charges, quickly draining the low-value
 *  relay key. Bidding a small explicit priority fee against the real live base fee (still
 *  with a generous margin for the ~12.5%/block max base-fee move before this mines) avoids
 *  that. */
export async function lowFeeOverrides(
  provider: BrowserProvider,
): Promise<{ maxPriorityFeePerGas: bigint; maxFeePerGas: bigint }> {
  const block = await provider.send("eth_getBlockByNumber", ["latest", false]);
  const baseFee = BigInt(block.baseFeePerGas ?? "0x0");
  const maxPriorityFeePerGas = 1_000n;
  return { maxPriorityFeePerGas, maxFeePerGas: baseFee * 4n + maxPriorityFeePerGas };
}

export interface PostTxRunResult {
  /** "reverted": the POST_TX frame's assertion failed — the tx still mines (nonce consumed,
   *  gas charged, viewable on the explorer) but with a failure receipt, per EIP-7906's
   *  partial-revert semantics. "excluded": no receipt ever appeared and the nonce didn't
   *  advance — a genuine mempool drop, not a caught assertion; rare and not the normal
   *  failure path. */
  outcome: "success" | "reverted" | "excluded";
  rawHex: string;
  sigHash: string;
  txHash: string;
  receipt?: Record<string, unknown>;
}

const RECEIPT_POLL_INTERVAL_MS = 2000;
const RECEIPT_POLL_ATTEMPTS = 20; // ~40s

export interface DefaultFrameCall {
  target: string;
  data: string; // hex
  gasLimit: number;
}

/** A scenario's own complete, already-built frame list plus everything needed to place it in
 *  the envelope (sender, nonce keys/seq, optional recent-root references) -- no assumed shape:
 *  every scenario builds its own complete frame list (the 6 attack scenarios and shield
 *  VERIFY(self)+..., private-swap VERIFY(pool)+SENDER+DEFAULT+POST_TX with keyed nonces and a
 *  recent-root reference). */
export interface FrameTxPlan {
  sender: string | bigint;
  nonceKeys: (bigint | number)[];
  nonceSeq: bigint | number;
  frames: Frame[]; // caller builds every frame -- no assumed shape
  recentRootRefs?: Uint8Array[];
}

/**
 * Builds, signs, and submits an EIP-8141 frame transaction from a caller-supplied FrameTxPlan --
 * the one shared build -> sign(unsigned placeholder) -> rebuild-with-real-signature ->
 * eth_sendRawTransaction -> poll-receipt implementation every scenario in this app submits
 * through, regardless of its own frame shape (see HegotaWalletScenario.buildFrames in
 * hegotaScenarios/types.ts).
 *
 * `signer` is whatever the caller passes -- this function has no opinion on how (or whether) the
 * user approved what's about to be signed, it just calls `signer.sign(tx)`. WalletSimulatorPanel
 * (the only caller) always passes a plain `autoWalletSigner(address)`: it renders the decoded
 * frame tx on its own device screens and treats its own Submit click as the approval, rather
 * than gating the signature behind a separate preview-and-resolve round trip.
 */
export async function submitFrameTx(
  provider: BrowserProvider,
  plan: FrameTxPlan,
  signer: FrameSigner,
): Promise<PostTxRunResult> {
  const p = provider;

  const block = await p.send("eth_getBlockByNumber", ["latest", false]);
  const baseFee = BigInt(block.baseFeePerGas ?? "0x0");
  // See lowFeeOverrides's comment above for why this bids a small explicit priority fee
  // against the real live base fee rather than trusting Hegotá's fee-suggestion RPCs.
  const maxPriorityFee = 1_000n;
  const maxFee = baseFee * 4n + maxPriorityFee;

  function build(sig: FrameSig): FrameTx {
    return new FrameTx({
      chainId: HEGOTA_CHAIN_ID,
      nonceKeys: plan.nonceKeys,
      nonceSeq: plan.nonceSeq,
      sender: plan.sender,
      frames: plan.frames,
      signatures: [sig],
      maxPriorityFee,
      maxFee,
      recentRootRefs: plan.recentRootRefs,
    });
  }

  // Sign the sig_hash of a tx built with an empty placeholder signature, then rebuild with the
  // real signature (mirrors frametx_submit.py's build()).
  const unsigned = build(new FrameSig(SigScheme.SECP256K1, signer.address, new Uint8Array(0), new Uint8Array(0)));
  const sigHashBytes = unsigned.sigHash();
  const signature = await signer.sign(unsigned);
  const sigBytes = packFrameSignature(signature);

  const tx = build(new FrameSig(SigScheme.SECP256K1, signer.address, new Uint8Array(0), sigBytes));
  const rawHex = hex(tx.raw());
  const sigHash = hex(sigHashBytes);

  const txHash: string = await p.send("eth_sendRawTransaction", [rawHex]);

  const nonceBefore = BigInt(plan.nonceSeq);
  for (let i = 0; i < RECEIPT_POLL_ATTEMPTS; i++) {
    const receipt = await p.send("eth_getTransactionReceipt", [txHash]);
    if (receipt) {
      const outcome = receipt.status === "0x1" ? "success" : "reverted";
      return { outcome, rawHex, sigHash, txHash, receipt };
    }
    await new Promise((r) => setTimeout(r, RECEIPT_POLL_INTERVAL_MS));
  }

  // No receipt within the poll window -- confirm it's a genuine mempool drop (nonce not
  // advanced) rather than just slow to mine. Note: this compares plan.sender's own
  // account-nonce count, which is only meaningful for a plain-account-nonce sender (every
  // self-verify scenario); a pool-as-sender plan with keyed nonces needs a different check.
  const senderAddr = typeof plan.sender === "string" ? plan.sender : "0x" + plan.sender.toString(16);
  const nonceAfter = BigInt(await p.send("eth_getTransactionCount", [senderAddr, "latest"]));
  if (nonceAfter > nonceBefore) {
    throw new Error(
      `Transaction ${txHash} did not return a receipt within the poll window, but the nonce advanced — it may still be mining. Check the Dora explorer.`,
    );
  }

  return { outcome: "excluded", rawHex, sigHash, txHash };
}
