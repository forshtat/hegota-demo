// No backdrop-click or Escape dismiss; "I've saved it -- continue" only enables once "Copy
// note" has been clicked at least once, so the note can't be dismissed without being copied.

import { useEffect, useState } from "react";
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

export default function SecretNoteDialog({
  open,
  ticketText,
  onDismiss,
}: {
  open: boolean;
  ticketText: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    if (open) {
      setCopied(false);
      setCopyFailed(false);
    }
  }, [open, ticketText]);

  return (
    <Dialog open={open} disableEscapeKeyDown maxWidth="sm" fullWidth>
      <DialogTitle sx={{ color: "error.main" }}>Secret note — copy this now</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          This is the only copy. It isn't saved anywhere on this page — copy it and paste it
          into the field on the Private side to continue as the withdrawer. Lose it and this
          deposit is unspendable, same as losing a hardware wallet's seed phrase.
        </Typography>
        <Box
          component="code"
          sx={{
            display: "block",
            fontFamily: '"IBM Plex Mono", monospace',
            fontSize: "0.75rem",
            wordBreak: "break-all",
            bgcolor: "background.default",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            p: 1.5,
          }}
        >
          {ticketText}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Stack direction="row" spacing={1.5} sx={{ width: "100%" }}>
          <Button
            variant="outlined"
            color="error"
            startIcon={<ContentCopyIcon fontSize="small" />}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(ticketText);
                setCopyFailed(false);
              } catch {
                setCopyFailed(true);
              }
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy note"}
          </Button>
          <Button
            variant="contained"
            color="error"
            startIcon={<CheckCircleIcon fontSize="small" />}
            disabled={!copied}
            onClick={onDismiss}
            sx={{ ml: "auto" }}
          >
            I've saved it — continue
          </Button>
        </Stack>
        {copyFailed && (
          <Typography variant="caption" color="warning.main" sx={{ display: "block", mt: 0.5 }}>
            Automatic copy failed — select the text above manually instead.
          </Typography>
        )}
      </DialogActions>
    </Dialog>
  );
}
