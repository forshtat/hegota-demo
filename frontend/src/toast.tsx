import { useSnackbar, type VariantType } from "notistack";
import { IconButton, Link as MuiLink, Stack } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CloseIcon from "@mui/icons-material/Close";
import { doraTxUrl } from "./dora.js";

export function useTxToast() {
  const { enqueueSnackbar, closeSnackbar } = useSnackbar();

  // "reverted"/"excluded" still get their own (warning, not error) toast -- both are real,
  // visible-on-chain outcomes this demo deliberately produces sometimes (a caught assertion),
  // not an app-level failure. Submission failures that never reach a receipt at all stay on the
  // inline Alert in whichever component tried the submission.
  function notifyMined(message: string, outcome: "success" | "reverted" | "excluded", txHash?: string) {
    const variant: VariantType = outcome === "success" ? "success" : "warning";
    enqueueSnackbar(message, {
      variant,
      action: txHash
        ? () => (
            <MuiLink
              href={doraTxUrl(txHash)}
              target="_blank"
              rel="noopener noreferrer"
              underline="hover"
              sx={{ color: "inherit", fontWeight: 600, mr: 1, whiteSpace: "nowrap" }}
            >
              View on Dora ↗
            </MuiLink>
          )
        : undefined,
    });
  }

  // Persists until the user dismisses it, unlike notifyMined's toasts, since a diagnostic
  // message someone needs to read and possibly copy into a bug report shouldn't vanish on its
  // own timer.
  function notifyError(message: string) {
    enqueueSnackbar(message, {
      variant: "error",
      persist: true,
      action: (key) => (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <IconButton
            size="small"
            color="inherit"
            onClick={() => void navigator.clipboard.writeText(message)}
            title="Copy error message"
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" color="inherit" onClick={() => closeSnackbar(key)} title="Dismiss">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      ),
    });
  }

  return { notifyMined, notifyError };
}
