// The Private Swap page's deposit ("shield") half, as a HegotaWalletScenario -- the same
// interface the six attack scenarios use, so the one unified wallet simulator
// (components/hegotaWallet/WalletSimulatorPanel.tsx) drives this flow too instead of
// PrivateSwap.tsx building, signing, and submitting the transaction inline.
//
// No `prepare`/`previewPrepare`: the envelope is always signed and paid for by the acting
// account's own embedded key (WalletSimulatorPanel signs every plan with
// autoWalletSigner(address)), so the on-chain transaction's own sender already proves who
// deposited -- there is nothing left for the connected wallet to separately authorize, and the
// frame screens are the whole review.
//
// The note material (spendKey/rho/cm) is generated here, inside buildFrames, rather than by the
// page: it is scenario-local async work with nothing for a wallet to sign, which is exactly what
// buildFrames is reserved for. See `noteMaterial` below for why it is cached rather than
// regenerated per call.

import { formatEther, getBytes, id as keccakId, Interface } from "ethers";
import { Frame, FrameMode } from "../frametx.js";
import { fetchSelfVerifyNonce, registerCuratedRows, registerKnownInterface } from "../frameSigning.js";
import type { CuratedRow } from "../signingPreview.js";
import type { HegotaWalletScenario, ScenarioExplainer } from "../hegotaScenarios/types.js";
import { newNote, inner, commitment } from "./note.js";
import { hex32 } from "./poseidon.js";
import { poolIface } from "./privateSwapTx.js";
import { RequiredEventAssertionABI } from "../contracts/abis.js";

const POOL = import.meta.env.VITE_HEGOTA_POOL ?? "";
// The same RequiredEventAssertion contract this demo's very first POST_TX scenario used
// (hegotaWallet.ts's now-deleted runPostTxScenario) -- still deployed, its address still
// written into frontend/.env by scripts/deploy-hegota.mjs on every redeploy, so reading it from
// the env var here (not a hardcoded address) means a redeploy that moves it needs nothing
// updated by hand, same as POOL above.
const ASSERTION = import.meta.env.VITE_HEGOTA_REQUIRED_EVENT_ASSERTION ?? "";
const assertionIface = new Interface(RequiredEventAssertionABI);
registerKnownInterface(assertionIface);

// keccak256("LeafAppended(bytes32,uint32,bytes32,uint64)") -- ShieldedPoolLogic.sol's own event,
// emitted exactly once per shield() call with the newly appended leaf's index as its first
// non-indexed field (cm itself is indexed, so it lands in topic1, not data -- unavailable to
// RequiredEventAssertion's topic0+data[0:32] check, which is why this proves *position*, not
// *identity*: "a commitment landed at exactly the leaf index this deposit was quoted for" -- see
// buildFrames' own comment on why that's still a meaningful, non-decorative assertion).
const LEAF_APPENDED_TOPIC0 = keccakId("LeafAppended(bytes32,uint32,bytes32,uint64)");

registerCuratedRows("assertRequiredEvent", (dataHex): CuratedRow[] => {
  const [, expectedIndex] = assertionIface.decodeFunctionData("assertRequiredEvent", dataHex);
  return [{ label: "Proves", value: `Commitment landed at leaf #${expectedIndex}` }];
});

/** 0.01 ETH -- the fixed demo deposit, and the single source of that amount: PrivateSwap.tsx
 *  imports it from here for its own copy rather than the other way round, so this module stays
 *  free of any dependency on React or on the page that happens to arm it. */
export const SHIELD_VALUE = 10_000_000_000_000_000n;

/** Headroom above SHIELD_VALUE a self-sovereign deposit needs for its own gas -- generous given
 *  Hegotá's higher-than-mainnet state-gas pricing; the sidebar's faucet button sends more than
 *  this total. Checked up front so an under-funded account gets a sentence it can act on rather
 *  than an opaque envelope rejection from the node. */
const SHIELD_GAS_MARGIN = 5_000_000_000_000_000n;

// The curated row for the SENDER frame's `shield` call, registered here since this file owns
// the shield flow -- registered exactly once, at module load, same as every other scenario file
// does. `frameValue` is the deposit amount,
// which lives in the frame's own `value` field rather than in the calldata, so the row cannot be
// derived from `dataHex` alone. privateSwapTx.ts still registers the pool Interface itself
// (registerKnownInterface), which is what lets the generic decoder name this call "shield" in the
// first place; importing `poolIface` from there guarantees that module is loaded whenever this
// one is.
registerCuratedRows("shield", (_dataHex, frameValue): CuratedRow[] => [
  { label: "Shielding", value: `${formatEther(frameValue)} ETH` },
]);

export interface ShieldNoteMaterial {
  spendKey: bigint;
  rho: bigint;
  cm: bigint;
  innerVal: bigint;
}

// buildFrames is called more than once per run -- WalletSimulatorPanel's preview effect rebuilds
// the plan on every stage transition, and handleApprove may build it again -- so freshly
// randomizing the note on each call would mean the secret shown to the user afterwards belonged
// to a *different* plan than the one actually submitted, leaving the deposit permanently
// unspendable. Cached as a promise (not a resolved value) so two overlapping calls share one
// generation rather than racing to overwrite each other; `material` mirrors the resolved value so
// the post-submit handoff below can stay synchronous.
let materialPromise: Promise<ShieldNoteMaterial> | null = null;
let material: ShieldNoteMaterial | null = null;

async function noteMaterial(): Promise<ShieldNoteMaterial> {
  if (!materialPromise) {
    materialPromise = (async () => {
      const { spendKey, rho } = newNote();
      const innerVal = await inner(spendKey, rho);
      const cm = await commitment(spendKey, rho, SHIELD_VALUE);
      return { spendKey, rho, cm, innerVal };
    })();
  }
  material = await materialPromise;
  return material;
}

/** The one supported way to read the note material a completed run used, for whoever renders the
 *  secret-note ticket (PrivateSwap.tsx's own `onResult` wrapper). Clears the cache as it hands it
 *  over, so the next armed run generates a fresh note -- the ONLY place that reset happens, which
 *  is why this is a "take" rather than a getter. Returns null if called before any run built its
 *  frames, or twice for the same run. */
export function takeShieldNoteMaterial(): ShieldNoteMaterial | null {
  const taken = material;
  material = null;
  materialPromise = null;
  return taken;
}

function decodedDescription(): ScenarioExplainer {
  return {
    action: "Deposit into the shielded pool",
    changes: `Shields ${formatEther(SHIELD_VALUE)} ETH under a fresh, secret commitment, paid for and signed by this account itself`,
    risk: "Only the secret note shown once afterwards can ever spend this deposit — nothing stores it, and no on-chain record links it back to this address, so losing it strands the ETH in the pool for good",
  };
}

export const shieldScenario: HegotaWalletScenario = {
  id: "shield",
  walletTitle: "Shield a deposit",
  // Deliberately no `accountKind`: there is no smart account in this flow at all. The connected
  // account acts on its own behalf, so WalletSimulatorPanel treats the connected address as both
  // the acting account and the frame tx's sender, and gates nothing on account setup.
  decodedDescription,
  // Self-verify shape -- VERIFY(self, flags=0x03) + SENDER(pool, value, shield(inner)) +
  // POST_TX(RequiredEventAssertion): this is a POST_TX-assertions demo, so every flow gets one,
  // not just the ones an attacker could subvert (see the assertion's own comment below for what
  // it actually proves here). Shield consumes no keyed-nonce nullifier and references no recent
  // root (only the withdrawal side does), so this is an ordinary account-nonce transaction that
  // happens to be a frame tx.
  buildFrames: async ({ provider, senderAddress }, _quoteResult, _context, _triggerViolation, onProgress) => {
    // This account pays the deposit AND its own gas, so an insufficient balance is the one
    // failure worth naming precisely rather than letting the node reject the envelope.
    await onProgress?.("Checking account balance");
    const required = SHIELD_VALUE + SHIELD_GAS_MARGIN;
    const balance = await provider.getBalance(senderAddress);
    if (balance < required) {
      throw new Error(
        `This account needs at least ${formatEther(required)} ETH to deposit (has ${formatEther(balance)}) — use the Faucet button in the sidebar to top it up.`,
      );
    }

    await onProgress?.("Generating a secret note");
    const { innerVal } = await noteMaterial();
    const shieldCalldata = poolIface.encodeFunctionData("shield", [hex32(innerVal)]);

    await onProgress?.("Reading the account's nonce");
    const nonceSeq = await fetchSelfVerifyNonce(provider, senderAddress);

    // shield() always appends exactly one leaf at the pool's current nextIndex -- reading it now
    // and asserting the LeafAppended event landed at exactly this index afterward isn't
    // decorative the way asserting "some LeafAppended fired" would be (that would just restate
    // what a successful call already guarantees): it proves the commitment settled at the exact
    // position this deposit was quoted for, catching the one way this specific call actually
    // could behave unexpectedly -- another shield/transfer/withdraw interleaving first and
    // shifting where this one lands.
    await onProgress?.("Reading the pool's current state");
    const nextIndexResult = await provider.call({ to: POOL, data: poolIface.encodeFunctionData("nextIndex", []) });
    const [expectedIndex] = poolIface.decodeFunctionResult("nextIndex", nextIndexResult);
    const assertCalldata = assertionIface.encodeFunctionData("assertRequiredEvent", [
      LEAF_APPENDED_TOPIC0,
      expectedIndex,
    ]);

    await onProgress?.("Building the transaction");

    return {
      sender: senderAddress,
      nonceKeys: [0],
      nonceSeq,
      frames: [
        new Frame(FrameMode.VERIFY, 0x03, senderAddress, 80_000, 0, new Uint8Array(0)),
        new Frame(FrameMode.SENDER, 0, POOL, 10_000_000, SHIELD_VALUE, getBytes(shieldCalldata)),
        new Frame(FrameMode.POST_TX, 0, ASSERTION, 200_000, 0, getBytes(assertCalldata)),
      ],
    };
  },
  // No `onResult` here on purpose: the only post-success work is showing the secret-note ticket,
  // which is a dialog owned by PrivateSwap.tsx's own state. The page spreads this object and adds
  // its own onResult (reading takeShieldNoteMaterial() above), keeping this file's job to
  // building and describing a transaction -- the same division every other scenario file keeps.
};
