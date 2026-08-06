// Shared scenario abstraction every Hegotá-native demo plugs into: each concrete scenario
// object builds its own complete EIP-8141 frame list (buildFrames) and closes over its own
// scenario-specific business parameters (amounts, spenders, caps, which note is being spent,
// ...) rather than receiving them from the container — the container only ever supplies what's
// universally available to it: the provider and the accounts acting (see FrameBuildEnv).

import type { BrowserProvider, JsonRpcSigner } from "ethers";
import { nextActionHash, currentNonce, encodeExecuteAction, HEGOTA_POST_TX_EXECUTOR } from "../erc7579Account.js";
import { signDemoSmartAccountAction, previewDemoSmartAccountAction } from "../contracts/demoSmartAccountAction.js";
import { buildSafeExecTransaction, previewSafeExecTransaction } from "../contracts/safeExec.js";
import type { FrameTxPlan, PostTxRunResult } from "../hegotaWallet.js";
import type { SigningRequestPreview } from "../signingPreview.js";

export type { SigningRequestPreview };

// A fixed schema every scenario fills in, rendered by DecodedClaimSummary (used by both
// HegotaNativeAttackView's page-level panel and WalletSimulatorPanel's drawer summary).
// Standardized so every attack in the demo explains itself the same way, instead of each
// scenario returning its own ad hoc list of differently-named fields.
export interface ScenarioExplainer {
  /** What the dApp/signing UI tells you this transaction does. */
  action: string;
  /** What the transaction actually does/targets on-chain. */
  changes: string;
  /** The mechanism (how the attack works) and the concrete stakes (what it costs you) in one
   *  statement. */
  risk: string;
}

// Which account-provisioning hook (frontend/src/hooks/useErc7579Account.ts vs.
// frontend/src/hooks/useSafeAccount.ts) a scenario needs the wallet-simulator UI to gate its
// "Try it" button on. Absent entirely for shield/withdraw, which have no smart account at all
// -- see FrameBuildEnv's own comment.
export type AccountKind = "erc7579" | "safe";

/** Everything `buildFrames` needs from the container to build a real EIP-8141 envelope.
 *
 *  `accountAddress` is the *acting* account -- the ERC-7579 smart account, the connected
 *  wallet's Safe, or (for a scenario with no `accountKind` at all) the connected wallet itself.
 *  `senderAddress` is the connected EOA that always signs the outer envelope
 *  (WalletSimulatorPanel signs every plan with `autoWalletSigner(address)`, unconditionally) and
 *  is normally also the frame tx's own `sender` and the target of its VERIFY(self) frame -- a
 *  plan whose `sender` were the smart account instead would carry a signature that doesn't
 *  belong to it. For shield and every attack scenario the two are the same address. Withdraw is
 *  the one exception: its VERIFY frame targets the pool, not `senderAddress`, and checks a ZK
 *  proof rather than a signature-equals-sender relationship, so `plan.sender` there is
 *  deliberately the pool -- any key can sign that envelope regardless of who the real sender is
 *  (see privateSwapScenario.ts's own header comment for the full reasoning).
 *  `provider` is the connected BrowserProvider, needed for the sender's nonce lookup
 *  (`fetchSelfVerifyNonce`) and any other live read a scenario's frames depend on. */
export interface FrameBuildEnv {
  provider: BrowserProvider;
  accountAddress: string;
  senderAddress: string;
}

/** A scenario builds its own complete frame list via `buildFrames` -- there is no
 *  container-assembled fixed shape. `TContext` is whatever `prepare` hands off to `buildFrames`
 *  -- e.g. `prepareViaErc7579Account`/`prepareViaSafe`'s own return shapes below for the 6
 *  attack scenarios, or nothing at all for shield and withdraw, which have no `prepare` step.
 *
 *  There is no `frameSigner` field here: the outer frame-tx envelope signer is not
 *  per-scenario -- every scenario is signed the same way, by the container
 *  (WalletSimulatorPanel.tsx), with the connected account's own key via
 *  `autoWalletSigner(address)`. `relaySigner` is never used by anything built against this
 *  interface. (The container does not wrap that signer in `withFrameTxApproval`: it renders the
 *  decoded frame tx on its own device screens and takes the user's approval from its own Submit
 *  click, rather than through a cross-component request/resolve channel -- see
 *  WalletSimulatorPanel's `handleSubmit` for the full reasoning.) */
export interface HegotaWalletScenario<TContext = void> {
  id: string;
  walletTitle: string;
  // Gates the account-setup Alert; absent = no gating (shield/withdraw).
  accountKind?: AccountKind;
  decodedDescription(): ScenarioExplainer;
  quote?(provider: BrowserProvider, accountAddress: string): Promise<bigint>;

  /** Optional inner EIP-712 authorization BEFORE the real frame tx is built -- purely the
   *  smart-account/Safe access-control signature (PostTxExecutor.executeAction's signature, or
   *  a Safe SafeTx signature) that becomes a DEFAULT frame's calldata. Present on every attack
   *  scenario; absent on shield and withdraw -- neither has anything for the connected wallet to
   *  separately authorize (shield needs no attestation once every signer is the account's own
   *  key; withdraw's ZK proof is its own authorization). */
  prepare?(
    provider: BrowserProvider, signer: JsonRpcSigner, chainId: number,
    accountAddress: string, quoteResult: bigint | null, triggerViolation?: boolean,
  ): Promise<TContext>;
  /** Preview-only sibling, shown as the pager's first screen(s) when present. */
  previewPrepare?(
    provider: BrowserProvider, chainId: number, accountAddress: string,
    quoteResult: bigint | null, triggerViolation?: boolean,
  ): Promise<SigningRequestPreview>;
  /** The human-readable one-line decode of the inner authorization's `callData` -- what a real
   *  hardware wallet's Clear Signing shows instead of 21 characters of truncated hex ("Approve
   *  0xAtk… to spend unlimited SHIB"). Read by the container only when `previewPrepare` is also
   *  present (it labels that screen's Call Data field); shield/withdraw, having no inner
   *  authorization, omit both. */
  callSummary?(quoteResult: bigint | null, triggerViolation?: boolean): string | undefined;

  /** Builds the scenario's OWN complete frame list. 3 frames for every attack scenario
   *  (VERIFY-self, DEFAULT, POST_TX), 2 for shield (VERIFY-self, SENDER), 4 for withdraw
   *  (VERIFY(sender=pool), SENDER, DEFAULT, POST_TX). Any scenario-local async work with
   *  nothing for the wallet to sign (shield's note-material generation, withdraw's ZK proof
   *  generation) happens directly inside this function, not via `prepare` -- `prepare` is
   *  reserved for the one thing that genuinely needs the connected wallet's signature.
   *
   *  Takes a `FrameBuildEnv` (see its own comment) rather than a bare `accountAddress`: building
   *  a real envelope needs the provider (to read the sender's nonce) and the *sender's*
   *  address, which for the ERC-7579/Safe-backed attack scenarios is NOT the acting account.
   *
   *  `onProgress`: optional, called with a short human-readable label at each meaningful
   *  checkpoint (a balance check, a slow ZK proof, a network read) -- purely for a host-side
   *  "preparing transaction" popup (WalletSimulatorPanel/TransactionPrepDialog) to narrate while
   *  this runs, for scenarios with no `prepare` step (shield/withdraw), whose real work all
   *  happens here, before the simulated hardware wallet is ever shown anything. Every scenario
   *  runs correctly if this is never called or the caller ignores it entirely -- it is a pure
   *  progress side-channel, never a dependency of the returned FrameTxPlan.
   *
   *  Returns a Promise (not fire-and-forget): the real implementation holds it open for a
   *  minimum display time so a step that happens to resolve instantly (a local computation, a
   *  cached read) doesn't flash past unreadably -- `await`ing each call is what actually pauses
   *  the real work for that long, not a decoration the caller can skip. A scenario that calls
   *  `onProgress?.(...)` without awaiting it gets no pacing for that step, but still works. */
  buildFrames(
    env: FrameBuildEnv, quoteResult: bigint | null, context: TContext, triggerViolation?: boolean,
    onProgress?: (step: string) => Promise<void>,
  ): Promise<FrameTxPlan>;

  formatEnforcementText?(quoteResult: bigint | null): import("react").ReactNode;
  attacker?: { label: string; apply(provider: BrowserProvider, accountAddress: string): Promise<void> };
  violationToggle?: { label: string };

  /** Scenario-specific post-success handling -- shield's note-ticket dialog, withdraw's decoded
   *  effects + success dialog. Absent for the 6 attack scenarios (the generic result chip covers
   *  them). */
  onResult?(result: PostTxRunResult, accountAddress: string, context: TContext): void;
}

/** prepare() implementation for every ERC-7579-backed attack scenario: reads the account's
 *  current nonce, confirms PostTxExecutor's own `nextActionHash` (real, load-bearing -- the
 *  account's installed validator checks this exact signature before forwarding the call), then
 *  produces the EIP-712 signature. Returns the raw `{target, callData, signature}` tuple as
 *  `TContext`; the scenario's own `buildFrames` is what encodes this into the DEFAULT frame via
 *  `encodeExecuteAction`. */
export async function prepareViaErc7579Account(
  provider: BrowserProvider,
  signer: JsonRpcSigner,
  chainId: number,
  accountAddress: string,
  target: string,
  callData: string,
): Promise<{ target: string; callData: string; signature: string }> {
  const nonce = await currentNonce(provider, accountAddress);
  await nextActionHash(provider, accountAddress, target, callData);
  const signature = await signDemoSmartAccountAction(signer, chainId, { account: accountAddress, target, callData, nonce });
  return { target, callData, signature };
}

/** previewPrepare() sibling of prepareViaErc7579Account. */
export async function previewPrepareErc7579Account(
  provider: BrowserProvider,
  chainId: number,
  accountAddress: string,
  target: string,
  callData: string,
): Promise<SigningRequestPreview> {
  const nonce = await currentNonce(provider, accountAddress);
  return previewDemoSmartAccountAction(chainId, { account: accountAddress, target, callData, nonce });
}

/** prepare() implementation for the Safe-backed attack scenario (Control-Plane Takeover).
 *  `account` here is the connected wallet's own Safe (frontend/src/hegotaSafeAccount.ts), not a
 *  smart-account address like prepareViaErc7579Account's. Builds a signed SafeTx dispatching
 *  `target`/`callData` via DELEGATECALL by default (operation=1) -- the real mechanism the
 *  attack depends on (contracts/hegota/MaliciousSafeDelegate.sol): a delegatecall executes in
 *  the SAFE's own storage context, so whichever contract is delegatecalled controls the Safe's
 *  own control-plane storage directly, exactly like the real Bybit-style hijack this demo
 *  models -- a disguised transaction whose true (delegatecall) effect on the signer's own
 *  account is never surfaced by the signing UI. Builds and signs only; the scenario's own
 *  `buildFrames` is what turns `signedSafeTx` into the DEFAULT frame. */
export async function prepareViaSafe(
  _provider: BrowserProvider,
  signer: JsonRpcSigner,
  _chainId: number,
  account: string,
  target: string,
  callData: string,
  operation: number = 1,
): Promise<{ signedSafeTx: { target: string; data: string; gasLimit: number } }> {
  const result = await buildSafeExecTransaction(account, signer, target, 0n, callData, operation);
  return { signedSafeTx: result };
}

/** previewPrepare() sibling of prepareViaSafe. `_chainId` is ignored -- previewSafeExecTransaction
 *  derives chainId fresh from the provider. Operation is hardcoded to 1 (DELEGATECALL), matching
 *  prepareViaSafe's own unconditional choice. */
export async function previewPrepareSafe(
  provider: BrowserProvider,
  _chainId: number,
  account: string,
  target: string,
  callData: string,
  operation: number = 1,
): Promise<SigningRequestPreview> {
  return previewSafeExecTransaction(account, provider, target, 0n, callData, operation);
}
