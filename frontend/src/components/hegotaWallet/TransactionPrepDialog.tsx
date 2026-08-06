// Deliberately its own separate Dialog rather than an overlay on WalletSimulatorPanel's device
// chrome: a real hardware wallet has no visibility into the RPC round trips its companion app
// makes before handing over a signing request -- it's either idle or showing a real request,
// nothing in between -- so narrating that in-between work inside the simulated device would
// misrepresent what a hardware wallet actually does.

import { Alert, Button, CircularProgress, Dialog, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import MemoryIcon from "@mui/icons-material/Memory";

export interface PrepStep {
  label: string;
  status: "active" | "done" | "error";
}

export default function TransactionPrepDialog({
  open,
  steps,
  error,
  onClose,
}: {
  open: boolean;
  steps: PrepStep[];
  error: string | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      disableEscapeKeyDown={!error}
      onClose={(_event, reason) => {
        if (!error && (reason === "backdropClick" || reason === "escapeKeyDown")) return;
        onClose();
      }}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <MemoryIcon fontSize="small" />
        Preparing transaction
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
          Assembling the request the hardware wallet will review -- this all happens on this
          device before the wallet ever sees anything.
        </Typography>
        <Stack spacing={1.5}>
          {steps.map((step, i) => (
            <Stack key={i} direction="row" spacing={1.5} alignItems="center">
              {step.status === "done" ? (
                <CheckCircleIcon fontSize="small" color="success" />
              ) : step.status === "error" ? (
                <ErrorIcon fontSize="small" color="error" />
              ) : (
                <CircularProgress size={16} thickness={5} />
              )}
              <Typography
                variant="body2"
                sx={{
                  color: step.status === "done" ? "text.secondary" : step.status === "error" ? "error.main" : "text.primary",
                  fontWeight: step.status === "active" ? 600 : 400,
                }}
              >
                {step.label}
              </Typography>
            </Stack>
          ))}
        </Stack>
        {error && (
          <>
            <Alert severity="error" sx={{ mt: 2.5 }}>{error}</Alert>
            <Button variant="outlined" color="inherit" onClick={onClose} sx={{ mt: 2 }} fullWidth>
              Close
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
