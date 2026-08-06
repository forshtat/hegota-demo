// Unlike SecretNoteDialog, this one is freely dismissable (Escape/backdrop close it): a
// half-pasted or wrong note just leaves the Private side unable to proceed, with no risk of
// losing anything, so there's nothing that needs to be forced here.

import { useEffect, useState } from "react";
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";

export default function PasteSecretNoteDialog({
  open,
  value,
  error,
  loadedSummary,
  onChange,
  onClose,
}: {
  open: boolean;
  value: string;
  error: string | null;
  // Passed in rather than recomputed here: PrivateSwap.tsx already owns the decode
  // (handlePasteNote), the sole source of truth for `withdrawNote`.
  loadedSummary: string | null;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  // Bumping this key remounts the TextField so autoFocus fires again on each reopen.
  const [autoFocusKey, setAutoFocusKey] = useState(0);
  useEffect(() => {
    if (open) setAutoFocusKey((k) => k + 1);
  }, [open]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ color: "success.main" }}>Paste the secret note</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Paste the note the Public side gave you. It's checked the moment you paste it — nothing
          is submitted here, this just loads it for the private withdrawal below.
        </Typography>
        <TextField
          key={autoFocusKey}
          autoFocus
          fullWidth
          multiline
          minRows={3}
          placeholder="Paste the secret note from the left…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          sx={{
            mb: 1.5,
            "& .MuiInputBase-input": { fontFamily: '"IBM Plex Mono", monospace', fontSize: "0.75rem" },
          }}
        />
        {error && <Alert severity="error">{error}</Alert>}
        {loadedSummary && (
          <Typography variant="caption" color="success.main" sx={{ display: "block" }}>
            ✓ {loadedSummary}
          </Typography>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose} color="inherit">
          Cancel
        </Button>
        <Button
          variant="contained"
          color="success"
          startIcon={<CheckCircleIcon fontSize="small" />}
          disabled={!loadedSummary}
          onClick={onClose}
        >
          Use this note
        </Button>
      </DialogActions>
    </Dialog>
  );
}
