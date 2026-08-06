import { useEffect } from "react";
import confetti from "canvas-confetti";
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Stack, Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import DoraLink from "../DoraLink.js";

export default function SuccessDialog({
  open,
  bonusReceived,
  recipient,
  txHash,
  effects,
  onStartAgain,
  onClose,
}: {
  open: boolean;
  bonusReceived: string;
  recipient: string;
  txHash: string;
  effects: string[];
  onStartAgain: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    confetti({ particleCount: 140, spread: 80, origin: { y: 0.6 } });
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <IconButton aria-label="Close" onClick={onClose} sx={{ position: "absolute", right: 8, top: 8 }}>
        <CloseIcon fontSize="small" />
      </IconButton>
      <DialogTitle sx={{ color: "success.main" }}>Withdrawn privately</DialogTitle>
      <DialogContent>
        <Typography variant="body1" sx={{ mb: 2 }}>
          At least {bonusReceived} BONUS due at {recipient} — nothing on-chain links this receipt
          to the deposit that funded it.
        </Typography>
        {effects.length > 0 && (
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            <Typography variant="overline" color="text.secondary">
              What actually happened
            </Typography>
            {effects.map((effect, i) => (
              <Typography key={i} variant="body2" color="text.secondary">
                {effect}
              </Typography>
            ))}
          </Stack>
        )}
        <DoraLink txHash={txHash} />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button
          variant="contained"
          color="success"
          startIcon={<RestartAltIcon />}
          onClick={onStartAgain}
          sx={{ fontWeight: 700 }}
        >
          Start Again
        </Button>
      </DialogActions>
    </Dialog>
  );
}
