import { useEffect, useState, type ReactNode } from "react";
import {
  Alert, Box, Button, Chip, CircularProgress, IconButton, Paper, Popover, Stack, Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import LockIcon from "@mui/icons-material/Lock";
import VisibilityIcon from "@mui/icons-material/Visibility";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import SwapIcon from "@mui/icons-material/Add";
import WifiOffIcon from "@mui/icons-material/WifiOff";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import HelpOutlineIcon from "@mui/icons-material/HelpOutline";
import { formatEther, getAddress } from "ethers";
import { useWallet } from "../contexts/WalletContext.js";
import { useHegotaWalletPanel } from "../contexts/HegotaWalletPanelContext.js";
import { HEGOTA_CHAIN_ID } from "../hegotaWallet.js";
import { doraAddressUrl } from "../dora.js";
import PageContainer from "../components/layout/PageContainer.js";
import DoraLink from "../components/DoraLink.js";
import SecretNoteDialog from "../components/hegotaWallet/SecretNoteDialog.js";
import PasteSecretNoteDialog from "../components/hegotaWallet/PasteSecretNoteDialog.js";
import SuccessDialog from "../components/hegotaWallet/SuccessDialog.js";
import { decodeReceiptEffects } from "../shieldedPool/privateSwapTx.js";
import { shieldScenario, takeShieldNoteMaterial, SHIELD_VALUE } from "../shieldedPool/shieldScenario.js";
import { buildPrivateSwapScenario } from "../shieldedPool/privateSwapScenario.js";
import { encodeSecretNote, decodeSecretNote, type SecretNote } from "../shieldedPool/noteTicket.js";

const POOL = import.meta.env.VITE_HEGOTA_POOL ?? "";
const SOURCE_ID = import.meta.env.VITE_HEGOTA_POOL_SOURCE_ID ?? "";
const DEPLOY_BLOCK = parseInt(import.meta.env.VITE_HEGOTA_POOL_DEPLOY_BLOCK ?? "0");
const OUT_TOKEN = import.meta.env.VITE_HEGOTA_PRIVATE_SWAP_OUT_TOKEN ?? "";
const MOCK_SWAP = import.meta.env.VITE_HEGOTA_PRIVATE_SWAP_MOCK_SWAP ?? "";
const EXECUTOR = import.meta.env.VITE_HEGOTA_PRIVATE_SWAP_EXECUTOR ?? "";
const ASSERTION = import.meta.env.VITE_HEGOTA_PRIVATE_SWAP_ASSERTION ?? "";
const CONFIGURED = Boolean(POOL && SOURCE_ID && OUT_TOKEN && MOCK_SWAP && EXECUTOR && ASSERTION);

const STUB_CHIP_SX = {
  fontFamily: '"IBM Plex Mono", monospace',
  letterSpacing: "0.02em",
} as const;

const STAMP_BUTTON_SX = {
  fontFamily: '"IBM Plex Mono", monospace',
  letterSpacing: "0.06em",
  textTransform: "uppercase",
} as const;

type StepKey = "declare" | "paste" | "switch" | "clear" | "done";

const STEPS: { key: StepKey; label: string; color: "error.main" | "success.main" }[] = [
  { key: "declare", label: "Deposit ETH", color: "error.main" },
  { key: "paste", label: "Transfer Secret Note", color: "success.main" },
  { key: "switch", label: "Use private account", color: "success.main" },
  { key: "clear", label: "Withdraw privately", color: "success.main" },
  { key: "done", label: "Success", color: "success.main" },
];

// Omits spendKey/rho: those secrets only ever live in DepositTicket's one-time-shown
// ticketText, never carried around in state on their own.
type DepositMeta = Omit<SecretNote, "spendKey" | "rho">;

interface DepositTicket {
  meta: DepositMeta;
  ticketText: string;
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function InfoPopoverButton({ color, children }: { color: "error" | "success"; children: ReactNode }) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  return (
    <>
      <IconButton
        size="small"
        onClick={(e) => setAnchorEl((current) => (current ? null : e.currentTarget))}
        sx={{ color: `${color}.main`, p: 0.25 }}
        aria-label="More information"
      >
        <HelpOutlineIcon fontSize="small" />
      </IconButton>
      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: {
              maxWidth: 340,
              p: 2,
              border: "1px solid",
              borderColor: `${color}.main`,
              borderRadius: 1.5,
              mt: 0.5,
            },
          },
        }}
      >
        <Typography variant="body2" color="text.secondary">
          {children}
        </Typography>
      </Popover>
    </>
  );
}

export default function PrivateSwap() {
  const {
    isConnected, isHegota, chainId, provider, address, isDevAutoWallet,
    switchToHegota, isSwitchingNetwork, switchNetworkError,
    addHegotaNetwork, isAddingNetwork, addNetworkError,
  } = useWallet();
  const { arm, armAccountPicker } = useHegotaWalletPanel();

  // The note's secret never crosses from the deposit side to the withdrawal side on its own:
  // handleShield surfaces it once as copy-pasteable text, and handlePasteNote is the only thing
  // that ever populates withdrawNote, only from what the user pastes.
  const [depositTicket, setDepositTicket] = useState<DepositTicket | null>(null);
  const [noteModalOpen, setNoteModalOpen] = useState(false);

  const [pasteInput, setPasteInput] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [withdrawNote, setWithdrawNote] = useState<SecretNote | null>(null);
  const [pasteModalOpen, setPasteModalOpen] = useState(false);

  const [swapResult, setSwapResult] = useState<{ txHash: string; bonusReceived: bigint; recipient: string; effects: string[] } | null>(null);
  const [successModalOpen, setSuccessModalOpen] = useState(false);

  // HegotaWalletPanelContext's own pathname-watching effect closes the drawer on navigation,
  // so no cleanup is needed here.
  useEffect(() => {
    armAccountPicker();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onHegota = isConnected && isHegota;

  const normalizedAddress = address ? getAddress(address) : null;
  const knownDepositorAddress = withdrawNote
    ? getAddress(withdrawNote.depositorAddress)
    : depositTicket
      ? getAddress(depositTicket.meta.depositorAddress)
      : null;
  const sameAccountAsDepositor = Boolean(
    normalizedAddress && knownDepositorAddress && normalizedAddress === knownDepositorAddress,
  );
  // Stays false after a successful swap too -- only handleAbandon clears depositTicket, so the
  // Public side never silently reactivates on its own.
  const canStartNewShield = !depositTicket;

  // Derived only from ticket/swap state, never from which account is connected.
  const currentStepKey: StepKey = swapResult
    ? "done"
    : !depositTicket
      ? "declare"
      : !withdrawNote
        ? "paste"
        : sameAccountAsDepositor
          ? "switch"
          : "clear";
  const currentStepIndex = STEPS.findIndex((s) => s.key === currentStepKey);

  function handlePasteNote(value: string) {
    setPasteInput(value);
    setPasteError(null);
    if (!value.trim()) {
      setWithdrawNote(null);
      return;
    }
    try {
      setWithdrawNote(decodeSecretNote(value));
    } catch (e) {
      setWithdrawNote(null);
      setPasteError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleAbandon() {
    setDepositTicket(null);
    setNoteModalOpen(false);
    setPasteInput("");
    setPasteError(null);
    setWithdrawNote(null);
    setPasteModalOpen(false);
    setSwapResult(null);
    setSuccessModalOpen(false);
  }

  // Tied only to the ticket/swap lifecycle, never to which account is connected.
  const activeSide: "public" | "private" | "done" = swapResult ? "done" : depositTicket ? "private" : "public";

  function handleShield() {
    setSwapResult(null);
    setDepositTicket(null);
    setPasteInput("");
    setPasteError(null);
    setWithdrawNote(null);
    setPasteModalOpen(false);
    setNoteModalOpen(false);
    arm({
      ...shieldScenario,
      onResult: (result) => {
        const note = takeShieldNoteMaterial();
        if (result.outcome !== "success" || !result.receipt || !note || !address) return;
        const secretNote: SecretNote = {
          spendKey: note.spendKey.toString(),
          rho: note.rho.toString(),
          value: SHIELD_VALUE.toString(),
          shieldTxHash: result.txHash,
          shieldBlockNumber: parseInt(result.receipt.blockNumber as string, 16),
          cm: note.cm.toString(),
          depositorAddress: address,
          // No depositorSignature: the deposit tx's own sender is this account, already
          // verifiable on-chain.
        };
        const { spendKey: _sk, rho: _r, ...meta } = secretNote;
        setDepositTicket({ meta, ticketText: encodeSecretNote(secretNote) });
        setNoteModalOpen(true);
        // Re-arm the account picker -- arming the scenario above displaced it, and the next
        // steps ("paste the note", "connect a different account") need it back.
        armAccountPicker();
      },
    });
  }

  // Built fresh per attempt (unlike shieldScenario) because it closes over which note is being
  // spent; getMinOut is the one piece buildFrames produces that this page's success UI still needs.
  function handlePrivateSwap() {
    if (!withdrawNote) return;
    setSwapResult(null);
    const { scenario, getMinOut } = buildPrivateSwapScenario(withdrawNote);
    arm({
      ...scenario,
      onResult: async (result, accountAddress) => {
        const minOut = getMinOut();
        if (result.outcome !== "success" || !result.receipt || minOut === null) return;
        let effects: string[] = [];
        if (provider) {
          try {
            effects = await decodeReceiptEffects(provider, result.receipt);
          } catch {
            // Display-only enrichment -- never let a decode failure turn a successful,
            // unrepeatable withdrawal into a reported error.
          }
        }
        // Deliberately not clearing depositTicket/withdrawNote here -- both sides stay visible
        // until a new Shield click (handleShield) starts the next cycle.
        setSwapResult({ txHash: result.txHash, bonusReceived: minOut, recipient: accountAddress, effects });
        setSuccessModalOpen(true);
        armAccountPicker();
      },
    });
  }

  return (
    <Box sx={{ position: "relative", minHeight: "100vh" }}>
      <Box sx={{ position: "absolute", inset: 0, zIndex: 0, display: "flex" }}>
        <Box
          sx={{
            flex: 1,
            bgcolor: (theme) => alpha(theme.palette.error.main, 0.26),
            filter: activeSide !== "public" ? "grayscale(0.85) brightness(0.55)" : "none",
            transition: "filter 400ms ease",
          }}
        />
        <Box
          sx={{
            flex: 1,
            bgcolor: (theme) => alpha(theme.palette.success.main, 0.26),
            filter: activeSide !== "private" ? "grayscale(0.85) brightness(0.55)" : "none",
            transition: "filter 400ms ease",
          }}
        />
      </Box>

      <Box
        aria-hidden
        sx={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: 10,
          zIndex: 0,
          background:
            "linear-gradient(90deg, #3a3d42 0%, #9aa1ab 18%, #f2f4f7 38%, #ffffff 50%, #f2f4f7 62%, #9aa1ab 82%, #3a3d42 100%)",
          boxShadow: "0 0 18px 4px rgba(0,0,0,0.45)",
        }}
      />

      <Box sx={{ position: "relative", zIndex: 1 }}>
        <PageContainer>
          <Stack direction="row" spacing={{ xs: 2, md: 3 }} sx={{ px: { xs: 0, md: 4 }, mb: 5, pt: 2 }}>
            <Box
              sx={{
                flex: 1,
                textAlign: "center",
                filter: activeSide !== "public" ? "grayscale(0.85) brightness(0.55)" : "none",
                transition: "filter 400ms ease",
              }}
            >
              <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="center">
                <VisibilityIcon sx={{ fontSize: { xs: 34, md: 44 }, color: "error.main" }} />
                <Typography
                  variant="mono"
                  component="span"
                  sx={{
                    fontSize: { xs: "2.4rem", md: "3.4rem" },
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: "error.main",
                    lineHeight: 1,
                  }}
                >
                  Public
                </Typography>
              </Stack>
            </Box>
            <Box
              sx={{
                flex: 1,
                textAlign: "center",
                filter: activeSide !== "private" ? "grayscale(0.85) brightness(0.55)" : "none",
                transition: "filter 400ms ease",
              }}
            >
              <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="center">
                <LockIcon sx={{ fontSize: { xs: 34, md: 44 }, color: "success.main" }} />
                <Typography
                  variant="mono"
                  component="span"
                  sx={{
                    fontSize: { xs: "2.4rem", md: "3.4rem" },
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: "success.main",
                    lineHeight: 1,
                  }}
                >
                  Private
                </Typography>
              </Stack>
            </Box>
          </Stack>

          <Box
            sx={{
              px: { xs: 0, md: 4 },
              mb: 5,
            }}
          >
            <Box
              key={currentStepKey}
              sx={{
                bgcolor: "background.paper",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 1.5,
                boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
                px: 2.5,
                py: 1.5,
                "@keyframes tickerFade": { "0%": { opacity: 0.4 }, "100%": { opacity: 1 } },
                animation: "tickerFade 260ms ease-out",
              }}
            >
              <Stack
                direction="row"
                spacing={0.75}
                alignItems="center"
                justifyContent="center"
                sx={{ flexWrap: "wrap", rowGap: 0.5 }}
              >
                {STEPS.map((step, index) => {
                  const isDone = index < currentStepIndex;
                  const isActive = index === currentStepIndex;
                  const showCheck = isDone || (isActive && step.key === "done");
                  return (
                    <Stack key={step.key} direction="row" spacing={0.75} alignItems="center">
                      {index > 0 && (
                        <NavigateNextIcon fontSize="small" sx={{ color: "text.disabled" }} />
                      )}
                      <Typography
                        variant="mono"
                        sx={{
                          fontSize: isActive ? "0.875rem" : "0.6875rem",
                          letterSpacing: "0.06em",
                          textTransform: "uppercase",
                          fontWeight: isActive ? 700 : 400,
                          color: isActive ? step.color : isDone ? "text.secondary" : "text.disabled",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {showCheck ? "✓ " : ""}
                        {step.label}
                      </Typography>
                    </Stack>
                  );
                })}
              </Stack>

              {depositTicket && (
                <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1 }}>
                  {swapResult ? (
                    <Button
                      variant="contained"
                      color="success"
                      startIcon={<RestartAltIcon />}
                      onClick={handleAbandon}
                      sx={{ fontWeight: 700 }}
                    >
                      Start Again
                    </Button>
                  ) : (
                    <Button size="small" color="error" onClick={handleAbandon}>
                      Abandon deposit &amp; restart
                    </Button>
                  )}
                </Stack>
              )}
            </Box>
          </Box>

          <Stack direction={{ xs: "column", md: "row" }} spacing={{ xs: 2, md: 3 }} sx={{ px: { xs: 0, md: 4 }, mb: 6 }}>
            <Typography
              variant="body1"
              color="text.secondary"
              sx={{
                flex: 1,
                px: { xs: 1, md: 3 },
                filter: activeSide !== "public" ? "grayscale(0.85) brightness(0.55)" : "none",
                transition: "filter 400ms ease",
              }}
            >
              {isDevAutoWallet ? (
                <>
                  A genuine, self-signed EIP-8141 transaction — a two-frame shield this account
                  pays for itself, no relay involved.
                </>
              ) : (
                <>
                  A two-frame EIP-8141 transaction shields the deposit. You sign an EIP-712
                  attestation — the relay pays the gas.
                </>
              )}
            </Typography>
            <Typography
              variant="body1"
              color="text.secondary"
              sx={{
                flex: 1,
                px: { xs: 1, md: 3 },
                filter: activeSide !== "private" ? "grayscale(0.85) brightness(0.55)" : "none",
                transition: "filter 400ms ease",
              }}
            >
              Paste the secret note from the left, then one transaction withdraws, swaps, and
              proves the payout — no link back to the deposit.
            </Typography>
          </Stack>

          <Box sx={{ px: { xs: 0, md: 4 } }}>
            {!isConnected && (
              <Alert
                severity="warning"
                sx={{ mb: 3, alignItems: "center", "& .MuiAlert-action": { alignItems: "center", pt: 0 } }}
                action={<appkit-button />}
              >
                Connect your wallet to try this.
              </Alert>
            )}

            {isConnected && !onHegota && (
              <Paper variant="outlined" sx={{ p: 3, mb: 3, borderColor: "error.main" }}>
                <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
                  <WifiOffIcon color="error" />
                  <Typography variant="h6">Wrong network</Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
                  Your wallet is connected to chain {chainId ?? "unknown"}. This demo runs on the
                  Hegotá devnet — switch to it below.
                </Typography>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                  <Button
                    variant="contained"
                    startIcon={isSwitchingNetwork ? <CircularProgress size={16} color="inherit" /> : <SwapHorizIcon />}
                    onClick={switchToHegota}
                    disabled={isSwitchingNetwork || isAddingNetwork}
                  >
                    {isSwitchingNetwork ? "Switching..." : "Switch to Hegotá"}
                  </Button>
                  <Button
                    variant="outlined"
                    color="inherit"
                    startIcon={isAddingNetwork ? <CircularProgress size={16} /> : <SwapIcon />}
                    onClick={addHegotaNetwork}
                    disabled={isSwitchingNetwork || isAddingNetwork}
                  >
                    {isAddingNetwork ? "Adding..." : "Add Hegotá to wallet"}
                  </Button>
                </Stack>
                {(switchNetworkError || addNetworkError) && (
                  <Alert severity="warning" sx={{ mt: 1.5 }}>{switchNetworkError ?? addNetworkError}</Alert>
                )}
              </Paper>
            )}

            {onHegota && !CONFIGURED && (
              <Alert severity="error" sx={{ mb: 3 }}>
                Hegotá private-swap infrastructure is not configured. Run{" "}
                <code>node scripts/deploy-hegota-shielded-pool.mjs</code> and{" "}
                <code>node scripts/deploy-hegota-private-swap.mjs</code> from the project root to
                populate <code>frontend/.env</code>.
              </Alert>
            )}
          </Box>

          {onHegota && CONFIGURED && (
            <Stack direction={{ xs: "column", md: "row" }} spacing={{ xs: 5, md: 3 }} alignItems="stretch" sx={{ px: { xs: 0, md: 4 } }}>
              <Box
                sx={{
                  py: 4,
                  px: { xs: 1, md: 3 },
                  flex: 1,
                  filter: activeSide !== "public" ? "grayscale(0.85) brightness(0.55)" : "none",
                  transition: "filter 400ms ease",
                }}
              >
                  <Stack direction="row" alignItems="center" spacing={0.25} sx={{ mb: 2 }}>
                    <Typography variant="overline" sx={{ color: "error.main", fontWeight: 700 }}>
                      Deposit — filed under a visible identity
                    </Typography>
                    <InfoPopoverButton color="error">
                      {isDevAutoWallet ? (
                        <>
                          Deposits {formatEther(SHIELD_VALUE)} ETH into the pool under a fresh,
                          secret commitment — a real transaction this account submits and pays
                          for itself (deposit value plus gas). Low on funds? Use the Faucet button
                          in the sidebar's bottom-left corner. The note's secret appears in a popup
                          right after — copy it there; this app never carries it to the Private
                          side on its own.
                        </>
                      ) : (
                        <>
                          Deposits {formatEther(SHIELD_VALUE)} ETH into the pool under a fresh, secret
                          commitment. You'll sign an EIP-712 attestation with this account, proving it
                          made the deposit — the deposit transaction itself is paid by the demo's relay
                          key (sponsored, no gas needed), but the signature is real. The note's secret
                          appears in a popup right after — copy it there; this app never carries it to
                          the Private side on its own.
                        </>
                      )}
                    </InfoPopoverButton>
                  </Stack>

                  {!depositTicket && normalizedAddress && (
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 1.5,
                        mb: 2,
                        px: 2,
                        py: 1.25,
                        bgcolor: "background.paper",
                        border: "1px solid",
                        borderColor: "divider",
                        borderRadius: 1.5,
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
                          Active account
                        </Typography>
                        <Typography variant="mono" sx={{ fontSize: "0.8125rem", wordBreak: "break-all" }}>
                          {normalizedAddress}
                        </Typography>
                      </Box>
                      <IconButton
                        size="small"
                        component="a"
                        href={doraAddressUrl(normalizedAddress)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View on Dora"
                      >
                        <OpenInNewIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  )}

                  {depositTicket && (
                    <Box sx={{ mb: canStartNewShield ? 2 : 0 }}>
                      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
                        <Chip
                          label={`Deposit origin ${short(getAddress(depositTicket.meta.depositorAddress))}`}
                          variant="outlined"
                          size="small"
                          sx={STUB_CHIP_SX}
                        />
                        <Chip
                          label={`Shielded ${formatEther(BigInt(depositTicket.meta.value))} ETH`}
                          color="success"
                          size="small"
                          sx={STUB_CHIP_SX}
                        />
                      </Stack>
                      <Typography variant="mono" sx={{ display: "block", mt: 0.75, fontSize: "0.75rem", color: "text.secondary" }}>
                        {depositTicket.meta.depositorSignature
                          ? `Signed by ${short(getAddress(depositTicket.meta.depositorAddress))}`
                          : `Deposited by ${short(getAddress(depositTicket.meta.depositorAddress))} — ✓ on-chain`}
                      </Typography>
                      <DoraLink txHash={depositTicket.meta.shieldTxHash} />

                      <Button
                        size="small"
                        variant="text"
                        color="error"
                        startIcon={<VisibilityIcon fontSize="small" />}
                        onClick={() => setNoteModalOpen(true)}
                        sx={{ mt: 1 }}
                      >
                        View secret note again
                      </Button>
                    </Box>
                  )}

                  {canStartNewShield && (
                    <Stack spacing={1.5} alignItems="flex-start">
                      <Button
                        variant="outlined"
                        color="error"
                        size="large"
                        startIcon={<LockIcon />}
                        onClick={handleShield}
                        sx={STAMP_BUTTON_SX}
                      >
                        {`Shield ${formatEther(SHIELD_VALUE)} ETH`}
                      </Button>
                    </Stack>
                  )}
              </Box>

              <Box
                sx={{
                  py: 4,
                  px: { xs: 1, md: 3 },
                  flex: 1,
                  filter: activeSide !== "private" ? "grayscale(0.85) brightness(0.55)" : "none",
                  transition: "filter 400ms ease",
                }}
              >
                  <Stack direction="row" alignItems="center" spacing={0.25} sx={{ mb: 2 }}>
                    <Typography variant="overline" sx={{ color: "success.main", fontWeight: 700 }}>
                      Withdraw — cleared under a different identity
                    </Typography>
                    <InfoPopoverButton color="success">
                      Withdraws the shielded note straight into MockSwapETH, paying out BONUS tokens
                      to whichever account is connected right now — all in one frame transaction,
                      proof generated right here in the browser. Nothing on-chain links this account
                      to the deposit on the left.
                    </InfoPopoverButton>
                  </Stack>

                  {!depositTicket && (
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
                      Shield a note on the left first.
                    </Typography>
                  )}

                  {depositTicket && !swapResult && (
                    <Box sx={{ mb: 2 }}>
                      {withdrawNote ? (
                        <Stack spacing={0.75} alignItems="flex-start">
                          <Typography variant="caption" color="success.main" sx={{ display: "block" }}>
                            ✓ Note loaded — deposit origin {short(getAddress(withdrawNote.depositorAddress))}
                          </Typography>
                          <Button
                            size="small"
                            variant="text"
                            color="success"
                            startIcon={<ContentPasteIcon fontSize="small" />}
                            onClick={() => setPasteModalOpen(true)}
                          >
                            Change note
                          </Button>
                        </Stack>
                      ) : (
                        <Button
                          variant="outlined"
                          color="success"
                          startIcon={<ContentPasteIcon />}
                          onClick={() => setPasteModalOpen(true)}
                          sx={STAMP_BUTTON_SX}
                        >
                          Paste secret note
                        </Button>
                      )}
                      {pasteError && (
                        <Alert severity="error" sx={{ mt: 1 }}>{pasteError}</Alert>
                      )}
                    </Box>
                  )}

                  {withdrawNote && !swapResult && sameAccountAsDepositor && (
                    <Alert severity="warning" sx={{ mb: 2 }}>
                      Connect a different account in your wallet to continue privately — you're
                      still connected as the depositor ({short(knownDepositorAddress!)}).
                    </Alert>
                  )}
                  {withdrawNote && !swapResult && !sameAccountAsDepositor && normalizedAddress && (
                    <Chip
                      size="small"
                      variant="outlined"
                      color="success"
                      label={`Will receive as ${short(normalizedAddress)}`}
                      sx={{ ...STUB_CHIP_SX, mb: 2 }}
                    />
                  )}

                  {swapResult ? (
                    <Box>
                      <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", rowGap: 1 }}>
                        <Chip
                          label={`Private receiver ${short(getAddress(swapResult.recipient))}`}
                          variant="outlined"
                          color="success"
                          size="small"
                          sx={STUB_CHIP_SX}
                        />
                        <Chip
                          label={`Received ${formatEther(swapResult.bonusReceived)} BONUS`}
                          color="success"
                          size="small"
                          sx={STUB_CHIP_SX}
                        />
                      </Stack>
                      <DoraLink txHash={swapResult.txHash} />
                    </Box>
                  ) : (
                    <Stack spacing={1.5} alignItems="flex-start">
                      <Button
                        variant="contained"
                        color="success"
                        size="large"
                        startIcon={<SwapHorizIcon />}
                        disabled={!withdrawNote || sameAccountAsDepositor}
                        onClick={handlePrivateSwap}
                        sx={STAMP_BUTTON_SX}
                      >
                        Private swap
                      </Button>
                    </Stack>
                  )}
              </Box>
            </Stack>
          )}
        </PageContainer>
      </Box>
      {depositTicket && (
        <SecretNoteDialog
          open={noteModalOpen}
          ticketText={depositTicket.ticketText}
          onDismiss={() => setNoteModalOpen(false)}
        />
      )}
      <PasteSecretNoteDialog
        open={pasteModalOpen}
        value={pasteInput}
        error={pasteError}
        loadedSummary={
          withdrawNote ? `Note loaded — deposit origin ${short(getAddress(withdrawNote.depositorAddress))}` : null
        }
        onChange={handlePasteNote}
        onClose={() => setPasteModalOpen(false)}
      />
      {swapResult && (
        <SuccessDialog
          open={successModalOpen}
          bonusReceived={formatEther(swapResult.bonusReceived)}
          recipient={short(swapResult.recipient)}
          txHash={swapResult.txHash}
          effects={swapResult.effects}
          onStartAgain={handleAbandon}
          onClose={() => setSuccessModalOpen(false)}
        />
      )}
    </Box>
  );
}
