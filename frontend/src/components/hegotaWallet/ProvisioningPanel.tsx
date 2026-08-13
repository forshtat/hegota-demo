// The self-funded-provisioning counterpart to WalletSimulatorPanel.tsx, driven by a
// ProvisioningTask (HegotaWalletPanelContext.tsx) rather than a HegotaWalletScenario --
// provisioning has no quote, no separate inner-authorization step, and no violation toggle,
// so it doesn't need that interface's full shape, just: do some async host-side prep (a
// faucet claim + balance wait for account deploy, nothing at all for a bare self_verify),
// show the resulting frame tx on the device screens, and submit on approval.

import { useEffect, useState } from "react";
import type { BrowserProvider } from "ethers";
import { Alert, Button, Chip, CircularProgress, Divider, Paper, Stack } from "@mui/material";
import MemoryIcon from "@mui/icons-material/Memory";
import { useWallet } from "../../contexts/WalletContext.js";
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
import DeviceReviewScreen from "./DeviceReviewScreen.js";
import DeviceStatusText from "./DeviceStatusText.js";
import WalletSimulatorHeader from "./WalletSimulatorHeader.js";
import { buildFrameTxScreens, type Screen } from "./deviceScreens.js";
import TransactionPrepDialog, { type PrepStep } from "./TransactionPrepDialog.js";
import DoraLink from "../DoraLink.js";
import { formatWalletError } from "../../errorFormat.js";
import { useTxToast } from "../../toast.js";

type Stage = "building" | "review" | "submitting" | "done";

// Rebuilds the exact unsigned FrameTx submitFrameTx (hegotaWallet.ts) would build from this
// plan, purely so the device screens can decode and show it before anything is signed -- same
// live-baseFee fee derivation, so the digest shown here is the digest that actually gets
// signed on Submit (see WalletSimulatorPanel's own previewFrameTx for the same reasoning).
async function previewFrameTx(provider: BrowserProvider, plan: FrameTxPlan, signerAddress: string): Promise<FrameTx> {
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

export default function ProvisioningPanel() {
  const { provider } = useWallet();
  const { provisioningTask: task, armId, disarm } = useHegotaWalletPanel();
  const { notifyMined, notifyError } = useTxToast();

  const [stage, setStage] = useState<Stage>("building");
  const [plan, setPlan] = useState<FrameTxPlan | null>(null);
  const [signerAddress, setSignerAddress] = useState<string | null>(null);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [result, setResult] = useState<PostTxRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prepOpen, setPrepOpen] = useState(false);
  const [prepSteps, setPrepSteps] = useState<PrepStep[]>([]);
  const [prepError, setPrepError] = useState<string | null>(null);

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

  // Re-arming (including re-arming after a failure) resets everything and re-runs prepare().
  useEffect(() => {
    if (!task || !provider) return;
    let cancelled = false;
    setStage("building");
    setPlan(null);
    setSignerAddress(null);
    setScreens([]);
    setResult(null);
    setError(null);
    setPrepSteps([]);
    setPrepError(null);
    setPrepOpen(true);

    (async () => {
      const { plan: preparedPlan, signerAddress: signer } = await task.prepare(reportProgress);
      if (cancelled) return;
      const unsigned = await previewFrameTx(provider, preparedPlan, signer);
      if (cancelled) return;
      setPlan(preparedPlan);
      setSignerAddress(signer);
      setScreens(buildFrameTxScreens(describeFrameTx(unsigned)));
      setPrepOpen(false);
      setStage("review");
    })().catch((e) => {
      if (cancelled) return;
      markLastPrepStepErrored();
      setPrepError(formatWalletError(e));
      task.onPrepareError(e);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, armId, provider]);

  if (!task) return null;

  async function handleSubmit() {
    if (!provider || !plan || !signerAddress || !task) return;
    setError(null);
    setStage("submitting");
    try {
      const runResult = await submitFrameTx(provider, plan, autoWalletSigner(signerAddress));
      setResult(runResult);
      setStage("done");
      notifyMined(
        runResult.outcome === "success"
          ? `${task.title} — confirmed`
          : runResult.outcome === "reverted"
            ? `${task.title} — reverted`
            : `${task.title} — excluded`,
        runResult.outcome,
        runResult.txHash,
      );
      task.onResult(runResult);
    } catch (e) {
      setError(formatWalletError(e));
      // Surfaced as a pop-up (not just the inline Alert) since this is easy to miss otherwise
      // and the fix (claim from the Faucet) lives in a completely different part of the UI --
      // the sidebar, not this panel.
      if (e instanceof InsufficientBalanceError) notifyError(e.message);
      setStage("review");
    }
  }

  function handlePrepClose() {
    disarm();
  }

  return (
    <>
      <Paper variant="outlined" sx={{ p: 0, overflow: "hidden" }}>
        <WalletSimulatorHeader icon={<MemoryIcon fontSize="small" />} title="Hardware wallet simulator" />

        {stage === "review" || stage === "submitting" ? (
          <DeviceReviewScreen screens={screens} status={stage === "submitting" ? "pending" : "waiting"} />
        ) : (
          <DeviceStatusText>
            {/* "building": intentionally blank -- TransactionPrepDialog narrates this phase
                instead, since a real hardware wallet has nothing to show yet either. */}
            {stage === "done" && result && (
              <div>
                {result.outcome === "success"
                  ? "Transaction confirmed"
                  : result.outcome === "reverted"
                    ? "Transaction reverted"
                    : "Transaction excluded (unexpected)"}
              </div>
            )}
          </DeviceStatusText>
        )}

        <Stack spacing={1.5} sx={{ px: 2, pb: 2 }}>
          {error && <Alert severity="error">{error}</Alert>}

          {stage === "review" && (
            <Button variant="contained" onClick={handleSubmit}>Submit transaction</Button>
          )}

          {stage === "submitting" && (
            <Button variant="contained" disabled startIcon={<CircularProgress size={16} color="inherit" />}>
              Submitting...
            </Button>
          )}

          {stage === "done" && result && (
            <>
              <Stack direction="row" spacing={1} alignItems="center">
                {result.outcome === "success" ? (
                  <Chip label="Frames succeeded" color="success" size="small" />
                ) : result.outcome === "reverted" ? (
                  <Chip label="Transaction reverted" color="warning" size="small" />
                ) : (
                  <Chip label="Transaction excluded" color="warning" size="small" />
                )}
                <DoraLink txHash={result.txHash} sx={{ mt: 0, display: "inline" }} />
              </Stack>
              <Divider />
              <Button variant="text" onClick={disarm}>Close</Button>
            </>
          )}
        </Stack>
      </Paper>

      <TransactionPrepDialog open={prepOpen} steps={prepSteps} error={prepError} onClose={handlePrepClose} />
    </>
  );
}
