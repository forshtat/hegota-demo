// A toy stand-in for the "isolated device" half of Confident Clear Signing: this component
// independently determines the expected outcome and only asks the connected wallet to sign
// off on what it itself computed -- not real hardware isolation, but it models the
// architectural separation between "what's being requested" and "what decides it's safe."
//
// The "building" stage and TransactionPrepDialog exist because a real hardware wallet has no
// network connection and no visibility into its companion app's RPC calls -- it is either idle
// or showing a fully-formed request. All host-side assembly (balance/nonce/base-fee reads,
// sometimes a ZK proof) happens before the device ever renders anything, narrated in a separate
// popup (TransactionPrepDialog) that is not part of the device chrome -- the device stays blank
// until it has a real, complete request to show.

import { useEffect, useState } from "react";
import type { BrowserProvider } from "ethers";
import { Alert, Button, Chip, CircularProgress, Divider, Paper, Stack } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import MemoryIcon from "@mui/icons-material/Memory";
import VerifiedUserIcon from "@mui/icons-material/VerifiedUser";
import { useWallet } from "../../contexts/WalletContext.js";
import { useErc7579Account } from "../../hooks/useErc7579Account.js";
import { useSafeAccount } from "../../hooks/useSafeAccount.js";
import { useHegotaWalletPanel } from "../../contexts/HegotaWalletPanelContext.js";
import {
  HEGOTA_CHAIN_ID,
  submitFrameTx,
  InsufficientBalanceError,
  type FrameTxPlan,
  type PostTxRunResult,
} from "../../hegotaWallet.js";
import { autoWalletSigner, describeFrameTx } from "../../frameSigning.js";
import { FrameSig, FrameTx, SigScheme } from "../../frametx.js";
import type { HegotaWalletScenario } from "../../hegotaScenarios/types.js";
import DeviceReviewScreen from "./DeviceReviewScreen.js";
import DeviceStatusText from "./DeviceStatusText.js";
import WalletSimulatorHeader from "./WalletSimulatorHeader.js";
import { buildFrameTxScreens, buildHardwareWalletScreens, type Screen } from "./deviceScreens.js";
import TransactionPrepDialog, { type PrepStep } from "./TransactionPrepDialog.js";
import DoraLink from "../DoraLink.js";
import { formatWalletError } from "../../errorFormat.js";
import { useTxToast } from "../../toast.js";

// "building" is the host-side assembly phase, narrated entirely by TransactionPrepDialog,
// entered the instant a scenario arms (or a Simulate quote resolves) and left the moment the
// device has something real to show -- never a review stage (see isReviewStage), so none of the
// device chrome below renders anything for it.
type Stage = "idle" | "quoting" | "building" | "quoted" | "preparing" | "prepared" | "submitting" | "done";

// The three stages where the device shows a reviewable signing request rather than a status line.
function isReviewStage(stage: Stage): boolean {
  return stage === "quoted" || stage === "preparing" || stage === "prepared";
}

// Rebuilds the exact unsigned FrameTx submitFrameTx (hegotaWallet.ts) would build from this
// plan, purely so the device screens can decode and show it before anything is signed: same
// chain id, fee derivation, and empty-signature placeholder -- so the digest shown here is the
// digest that will actually be signed, as long as the base fee hasn't moved between preview and
// submit (this devnet's base fee sits at a handful of wei and effectively never moves). This is
// the ONLY preview of the frame tx the user gets, and the panel takes its approval from the
// Submit click on these very screens (see handleSubmit) -- so keeping this construction
// identical to submitFrameTx's is what makes that approval meaningful.
async function previewFrameTx(
  provider: BrowserProvider,
  plan: FrameTxPlan,
  signerAddress: string,
): Promise<FrameTx> {
  const block = await provider.send("eth_getBlockByNumber", ["latest", false]);
  const baseFee = BigInt(block.baseFeePerGas ?? "0x0");
  const maxPriorityFee = 1_000n;
  const maxFee = baseFee * 4n + maxPriorityFee;
  return new FrameTx({
    chainId: HEGOTA_CHAIN_ID,
    nonceKeys: plan.nonceKeys,
    nonceSeq: plan.nonceSeq,
    sender: plan.sender,
    frames: plan.frames,
    signatures: [new FrameSig(SigScheme.SECP256K1, signerAddress, new Uint8Array(0), new Uint8Array(0))],
    maxPriorityFee,
    maxFee,
    recentRootRefs: plan.recentRootRefs,
  });
}

export default function WalletSimulatorPanel<TContext = unknown>({
  scenario,
  onDone,
}: {
  scenario: HegotaWalletScenario<TContext> | null;
  onDone?(result: PostTxRunResult, violationArmed: boolean): void;
}) {
  const { provider, signer, address, chainId } = useWallet();
  const { options, armId, disarm } = useHegotaWalletPanel();
  const { notifyMined, notifyError } = useTxToast();
  // Both account hooks are called unconditionally (rules of hooks); which one actually gates
  // this scenario depends on its accountKind -- Control-Plane Takeover is authorized through the
  // connected wallet's own Gnosis Safe, the other attack scenarios through an ERC-7579 smart
  // account. Safe accounts have no separate funding step, so isFunded is trivially true there.
  // A scenario with NO accountKind at all (shield/withdraw) acts as the connected wallet itself
  // -- there is no smart account in the picture, so the connected address IS the acting account
  // and there is nothing to gate on.
  const erc7579 = useErc7579Account();
  const safe = useSafeAccount();
  const usesSafeAccount = scenario?.accountKind === "safe";
  const gatesOnAccount = scenario?.accountKind !== undefined;
  const accountAddress = gatesOnAccount
    ? usesSafeAccount
      ? safe.safeAddress
      : erc7579.accountAddress
    : address;
  const isDeployed = usesSafeAccount ? safe.isDeployed : erc7579.isDeployed;
  const isFunded = usesSafeAccount ? true : erc7579.isFunded;

  const [stage, setStage] = useState<Stage>("idle");
  const [quoteResult, setQuoteResult] = useState<bigint | null>(null);
  // Wrapped in an object so "no context yet" (null) stays distinguishable from a scenario whose
  // TContext genuinely is undefined/void (shield and withdraw, which have no prepare step).
  const [context, setContext] = useState<{ value: TContext } | null>(null);
  // The plan locked in by "Approve with wallet" -- what Submit actually sends.
  const [pendingPlan, setPendingPlan] = useState<FrameTxPlan | null>(null);
  // The plan the preview effect built, reused by handleApprove when it is already valid --
  // buildFrames can be genuinely expensive (withdraw generates a ZK proof inside it).
  const [previewPlan, setPreviewPlan] = useState<FrameTxPlan | null>(null);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [result, setResult] = useState<PostTxRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Separate from `error` (owned exclusively by handleApprove/handleSubmit's own try/catches) so
  // the recompute effect below can never clobber a real approve/submit failure with null on its
  // own success path.
  const [previewError, setPreviewError] = useState<string | null>(null);
  // TransactionPrepDialog's own state, entirely separate from the device's screens/error state
  // above -- see the effect below for why this narration is not part of the device chrome.
  const [prepOpen, setPrepOpen] = useState(false);
  const [prepSteps, setPrepSteps] = useState<PrepStep[]>([]);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [attackerArmedForRun, setAttackerArmedForRun] = useState(false);

  const violationEnabled = options?.triggerViolation ?? false;

  // On this devnet's own RPC, a "step" (a balance check, a cached local computation) can
  // resolve in well under 1ms -- fast enough that TransactionPrepDialog's checklist would just
  // flicker past unreadably instead of narrating anything. Holding the returned Promise open
  // for a floor of MIN_STEP_MS is what actually paces the real work: every scenario `await`s
  // this call before moving on to its next real checkpoint, so the delay isn't cosmetic -- it's
  // the one thing making each step genuinely visible before the next one starts.
  function reportProgress(label: string): Promise<void> {
    setPrepSteps((prev) => [
      ...prev.map((s) => (s.status === "active" ? { ...s, status: "done" as const } : s)),
      { label, status: "active" },
    ]);
    const MIN_STEP_MS = 1000;
    return new Promise((resolve) => setTimeout(resolve, MIN_STEP_MS));
  }

  function markLastPrepStepErrored() {
    setPrepSteps((prev) => prev.map((s, i) => (i === prev.length - 1 ? { ...s, status: "error" as const } : s)));
  }

  // Re-arming (or disarming) resets everything. A quote-less scenario has nothing to Simulate,
  // so it goes straight to "building" -- the prep dialog opens immediately, before the device
  // shows anything. Keyed on armId (not just scenario) so re-arming the *same* scenario -- e.g.
  // clicking "Try it with your wallet" again after a run completes -- also resets: armId
  // increments on every arm() call, while `scenario` is referentially unchanged for a
  // same-page re-click.
  useEffect(() => {
    setStage(scenario && !scenario.quote ? "building" : "idle");
    setQuoteResult(null);
    setContext(null);
    setPendingPlan(null);
    setPreviewPlan(null);
    setScreens([]);
    setResult(null);
    setError(null);
    setPreviewError(null);
    setPrepOpen(false);
    setPrepSteps([]);
    setPrepError(null);
  }, [scenario, armId]);

  // This panel (and the account hooks above) live inside WalletSimulatorDrawer, which is mounted
  // once for the app's whole lifetime and never remounts on route navigation -- so without this,
  // its isDeployed/isFunded would only ever reflect whatever was true the first time the app
  // loaded, even after the user finishes account setup in the same session. Re-check fresh every
  // time a scenario is armed.
  useEffect(() => {
    if (!scenario) return;
    void erc7579.refresh();
    void safe.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, armId]);

  // Assembles the device's screens -- runs once as the "building" stage's own host-side prep
  // (narrated in TransactionPrepDialog, opened the instant this effect starts that way), and
  // again on any later dependency change once already reviewing (most importantly the violation
  // toggle) to keep the device screen's Data field in sync -- silently, no dialog, since the
  // device already has *something* to show by then.
  useEffect(() => {
    if (!scenario || !provider || chainId === undefined || !accountAddress) {
      setScreens([]);
      return;
    }
    const initial = stage === "building";
    if (!initial && !isReviewStage(stage)) return;
    let cancelled = false;
    if (initial) {
      setPrepSteps([]);
      setPrepError(null);
      setPrepOpen(true);
    }
    (async () => {
      const next: Screen[] = [];
      let previewErr: string | null = null;
      let initialFailed = false;

      // (1) The optional inner authorization (PostTxExecutor.executeAction's EIP-712 signature,
      // or a Safe SafeTx signature). Absent for shield/withdraw, which have nothing for the
      // connected wallet to separately authorize -- those show frame screens only.
      if (scenario.previewPrepare) {
        try {
          if (initial) await reportProgress("Preparing the authorization request");
          const innerPreview = await scenario.previewPrepare(
            provider, chainId, accountAddress, quoteResult, violationEnabled,
          );
          next.push(
            ...buildHardwareWalletScreens(
              innerPreview,
              // The Clear Signing line for this screen's Call Data field.
              scenario.callSummary?.(quoteResult, violationEnabled),
              scenario.formatEnforcementText?.(quoteResult),
            ),
          );
        } catch (e) {
          if (initial) {
            initialFailed = true;
            if (!cancelled) {
              markLastPrepStepErrored();
              setPrepError(formatWalletError(e));
            }
          } else {
            throw e;
          }
        }
      }

      // (2) The real frame tx. Built from the scenario's own buildFrames -- but that needs the
      // context `prepare` produces, so for a scenario WITH a prepare step these screens only
      // appear once "Approve with wallet" has produced it (stage "prepared"). For a scenario
      // without one (shield/withdraw) the context is void and the frames are previewable
      // immediately, from stage "building" on.
      if (!initialFailed && address && (context !== null || !scenario.prepare)) {
        try {
          const plan =
            pendingPlan ??
            (await scenario.buildFrames(
              { provider, accountAddress, senderAddress: address },
              quoteResult, context ? context.value : (undefined as TContext), violationEnabled,
              initial ? reportProgress : undefined,
            ));
          const unsigned = await previewFrameTx(provider, plan, address);
          if (!cancelled) setPreviewPlan(plan);
          next.push(...buildFrameTxScreens(describeFrameTx(unsigned)));
        } catch (e) {
          if (!cancelled) setPreviewPlan(null);
          if (initial) {
            initialFailed = true;
            if (!cancelled) {
              markLastPrepStepErrored();
              setPrepError(formatWalletError(e));
            }
          } else if (next.length === 0) {
            // Only surface this as a visible error when there's nothing else on screen instead
            // -- a scenario with its own inner-authorization screens keeps those visible.
            previewErr = formatWalletError(e);
          }
        }
      }

      if (!cancelled) {
        setScreens(next);
        if (initial) {
          if (!initialFailed) {
            setPrepOpen(false);
            setStage("quoted");
          }
          // On failure, prepOpen/prepError stay set so the dialog shows the error and a Close
          // button; stage deliberately does NOT advance, so the blank "building" device stays
          // blank rather than showing anything half-built.
        } else {
          setPreviewError(previewErr);
        }
      }
    })().catch((e) => {
      if (!cancelled) {
        setScreens([]);
        if (initial) setPrepError((prev) => prev ?? formatWalletError(e));
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario, accountAddress, violationEnabled, quoteResult, stage, provider, chainId]);

  if (!scenario) return null;

  const canApprove = !!accountAddress && (!gatesOnAccount || (isDeployed && isFunded));

  async function handleSimulate() {
    if (!provider || !scenario?.quote || !accountAddress) return;
    setError(null);
    setStage("quoting");
    try {
      const quoted = await scenario.quote(provider, accountAddress);
      setQuoteResult(quoted);
      setStage("building");
    } catch (e) {
      setError(formatWalletError(e));
      setStage("idle");
    }
  }

  // The two-step approval's first step: the optional inner authorization, then the scenario's
  // own frame list. Signing and submitting the frame tx itself is deliberately left to the
  // Submit button -- what this step produces is the frame tx the device screens then show,
  // which the Submit click approves.
  async function handleApprove() {
    // `address` (the connected EOA) is required even for a scenario with no `prepare` step: it
    // is the frame tx's own sender, so buildFrames cannot build a plan without it.
    if (!scenario || !provider || !accountAddress || !address || chainId === undefined) return;
    // Only a scenario with a prepare step needs the connected signer at this point.
    if (scenario.prepare && !signer) return;
    setError(null);
    setStage("preparing");
    try {
      let ctx = context;
      if (scenario.prepare) {
        const value = await scenario.prepare(
          provider, signer!, chainId, accountAddress, quoteResult, violationEnabled,
        );
        ctx = { value };
        setContext(ctx);
      }
      const plan =
        previewPlan ??
        (await scenario.buildFrames(
          { provider, accountAddress, senderAddress: address },
          quoteResult, ctx ? ctx.value : (undefined as TContext), violationEnabled,
        ));
      setPendingPlan(plan);
      setStage("prepared");
    } catch (e) {
      setError(formatWalletError(e));
      setStage("quoted");
    }
  }

  async function handleSubmit(triggerAttacker: boolean = false) {
    if (!scenario || !provider || !address || !pendingPlan || !accountAddress) return;
    setError(null);
    setStage("submitting");
    setAttackerArmedForRun(triggerAttacker);
    try {
      if (triggerAttacker && scenario.attacker) {
        await scenario.attacker.apply(provider, accountAddress);
      }
      // No withFrameTxApproval wrapping needed here: this panel already IS the wallet UI for the
      // frame tx. It shows the decoded frames and the digest on its own device screens throughout
      // the review stages, and this click is the user's approval of exactly what those screens
      // show.
      const runResult = await submitFrameTx(provider, pendingPlan, autoWalletSigner(address));
      setResult(runResult);
      setStage("done");
      // revertedByDesign (below, in render) can't be reused here since it reads `result` state,
      // which hasn't re-rendered yet -- recomputed locally from this call's own
      // triggerAttacker/violationEnabled instead.
      const revertedByDesignNow = runResult.outcome === "reverted" && (triggerAttacker || violationEnabled);
      notifyMined(
        runResult.outcome === "success"
          ? `${scenario.walletTitle} — confirmed`
          : runResult.outcome === "reverted"
            ? revertedByDesignNow
              ? `${scenario.walletTitle} — reverted (assertion caught it)`
              : `${scenario.walletTitle} — reverted`
            : `${scenario.walletTitle} — excluded`,
        runResult.outcome,
        runResult.txHash,
      );
      scenario.onResult?.(runResult, accountAddress, context ? context.value : (undefined as TContext));
      onDone?.(runResult, triggerAttacker || violationEnabled);
    } catch (e) {
      setError(formatWalletError(e));
      // Surfaced as a pop-up (not just the inline Alert) since this is easy to miss otherwise
      // and the fix (claim from the Faucet) lives in a completely different part of the UI --
      // the sidebar, not this panel.
      if (e instanceof InsufficientBalanceError) notifyError(e.message);
      setStage("prepared");
    }
  }

  function reset() {
    setStage(scenario && !scenario.quote ? "building" : "idle");
    setQuoteResult(null);
    setContext(null);
    setPendingPlan(null);
    setPreviewPlan(null);
    setScreens([]);
    setResult(null);
    setError(null);
    setPreviewError(null);
    setPrepOpen(false);
    setPrepSteps([]);
    setPrepError(null);
  }

  // The prep dialog can only ever be closed by the user once it has failed -- there's nothing
  // sensible to leave it open to at that point, so this bails out of the whole armed scenario.
  // Retrying means re-clicking the page's own button, which re-arms (a fresh armId) and runs
  // this same prep flow again.
  function handlePrepClose() {
    disarm();
  }

  // Whether *this run* deliberately armed a violation (either toggle) at submit time. For a
  // reverted outcome, this is the difference between "the assertion caught the hijack you
  // armed" (the whole point of this project) and "something unexpected reverted a compliant
  // run."
  const violationArmed = attackerArmedForRun || violationEnabled;
  const revertedByDesign = result?.outcome === "reverted" && violationArmed;

  return (
    <>
      <Paper variant="outlined" sx={{ p: 0, overflow: "hidden" }}>
        <WalletSimulatorHeader icon={<MemoryIcon fontSize="small" />} title="Hardware wallet simulator" />

        {isReviewStage(stage) ? (
          // "prepared" deliberately maps to "waiting", NOT "approved": DeviceReviewScreen's
          // "approved" state replaces the whole screen body with a checkmark and disables the
          // pager, which would blank the frame-tx screens here at the exact moment they first
          // become available. `prepared` means "inner authorization done, frame tx now under
          // review", so the pager stays live; the real approval gesture is the Submit click
          // below, after which the device moves on to its "Waiting for block inclusion..."
          // status. The button's own "Approved" label is what acknowledges the inner
          // authorization.
          <DeviceReviewScreen screens={screens} status={stage === "preparing" ? "pending" : "waiting"} />
        ) : (
          <DeviceStatusText>
            {/* "building": intentionally blank -- TransactionPrepDialog narrates this phase
                instead, since a real hardware wallet has nothing to show yet either. */}
            {stage === "idle" && <div>Press "Simulate" to preview the outcome.</div>}
            {stage === "quoting" && <div>Reading pool price, computing quote...</div>}
            {stage === "submitting" && <div>Waiting for block inclusion...</div>}
            {stage === "done" && result && (
              <div>
                {result.outcome === "success"
                  ? "Transaction confirmed"
                  : result.outcome === "reverted"
                    ? revertedByDesign
                      ? "Transaction reverted — assertion caught it"
                      : "Transaction reverted (outcome mismatch)"
                    : "Transaction excluded (unexpected)"}
              </div>
            )}
          </DeviceStatusText>
        )}

        <Stack spacing={1.5} sx={{ px: 2, pb: 2 }}>
          {/* `error` (an explicit Approve/Submit failure) takes priority over `previewError`
              (a passive recompute failure) on the rare chance both are set at once. Initial-build
              failures never reach either of these -- they show inside TransactionPrepDialog
              instead, since the device panel isn't even open for them. */}
          {(error ?? previewError) && <Alert severity="error">{error ?? previewError}</Alert>}

          {gatesOnAccount && !canApprove && stage !== "done" && (
            <Alert severity="info">
              {usesSafeAccount
                ? "Your personal demo Safe (step 3 of account setup) isn't deployed yet — "
                : "Your ERC-7579 smart account isn't deployed and funded yet (steps 1–2 of account setup) — "}
              <RouterLink to="/account-setup">go to account setup</RouterLink>.
            </Alert>
          )}

          {stage === "idle" && scenario.quote && (
            <Button variant="contained" onClick={handleSimulate}>Simulate</Button>
          )}

          {isReviewStage(stage) && (
            <>
              <Button
                variant="outlined"
                startIcon={stage === "preparing" ? <CircularProgress size={16} /> : <VerifiedUserIcon />}
                disabled={!canApprove || stage === "preparing" || !!pendingPlan}
                onClick={handleApprove}
              >
                {pendingPlan ? "Approved" : "Approve with wallet"}
              </Button>

              {scenario.attacker ? (
                <Stack spacing={1}>
                  <Button variant="contained" disabled={!pendingPlan} onClick={() => handleSubmit(false)}>
                    Submit transaction (Without attack)
                  </Button>
                  <Button variant="contained" disabled={!pendingPlan} color="error" onClick={() => handleSubmit(true)}>
                    Submit transaction (With attack)
                  </Button>
                </Stack>
              ) : (
                <Button variant="contained" disabled={!pendingPlan} onClick={() => handleSubmit(false)}>
                  Submit transaction
                </Button>
              )}
            </>
          )}

          {stage === "submitting" && (
            <Button variant="contained" disabled startIcon={<CircularProgress size={16} color="inherit" />}>
              Submitting...
            </Button>
          )}

          {stage === "done" && result && (
            <>
              {revertedByDesign && (
                <Alert severity="success">
                  Assertion caught it — the hijack you armed was reverted on-chain. This is the
                  on-chain POST_TX check doing its job, not a glitch. The reverted transaction is
                  still mined and visible on the explorer below.
                </Alert>
              )}
              <Stack direction="row" spacing={1} alignItems="center">
                {result.outcome === "success" ? (
                  <Chip label="Frames succeeded" color="success" size="small" />
                ) : revertedByDesign ? (
                  <Chip label="Attack caught — transaction reverted" color="success" size="small" />
                ) : result.outcome === "reverted" ? (
                  <Chip label="Transaction reverted" color="warning" size="small" />
                ) : (
                  <Chip label="Transaction excluded" color="warning" size="small" />
                )}
                <DoraLink txHash={result.txHash} sx={{ mt: 0, display: "inline" }} />
              </Stack>
              <Divider />
              <Button variant="text" onClick={reset}>Run again</Button>
            </>
          )}
        </Stack>
      </Paper>

      <TransactionPrepDialog open={prepOpen} steps={prepSteps} error={prepError} onClose={handlePrepClose} />
    </>
  );
}
