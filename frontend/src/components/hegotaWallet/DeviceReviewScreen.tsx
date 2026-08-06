import { useEffect, useState } from "react";
import { Box, Chip, CircularProgress, IconButton, Stack, Typography } from "@mui/material";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DeviceScreen from "./DeviceScreen.js";
import type { Screen } from "./deviceScreens.js";

export type HardwareWalletStatus = "waiting" | "pending" | "approved";

const STATUS_TEXT: Record<HardwareWalletStatus, string> = {
  waiting: "Ready to sign",
  pending: "Confirming…",
  approved: "Approved",
};

export default function DeviceReviewScreen({
  screens,
  status = "waiting",
}: {
  screens: Screen[];
  status?: HardwareWalletStatus;
}) {
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    setPageIndex(0);
  }, [screens]);

  const screen = screens[pageIndex];

  return (
    <Box>
      <DeviceScreen>
        {status === "approved" ? (
          <Stack alignItems="center" justifyContent="center" spacing={1} sx={{ height: "100%" }}>
            <Typography variant="h5" sx={{ color: "success.main" }}>✓</Typography>
            <Typography variant="body2" fontWeight={700}>Approved</Typography>
          </Stack>
        ) : !screen ? (
          <Typography variant="caption" color="text.secondary">Waiting for signing request…</Typography>
        ) : screen.kind === "detail" ? (
          <Stack spacing={0.75}>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Typography
                variant="caption"
                color={screen.accent ? `${screen.accent}.main` : "text.secondary"}
                sx={{ textTransform: "uppercase", letterSpacing: 1 }}
              >
                {screen.label}
              </Typography>
              {screen.chip && (
                <Chip label={screen.chip} size="small" color="info" sx={{ height: 16, fontSize: "0.6rem" }} />
              )}
            </Stack>
            <Typography component="div" variant="mono" fontWeight={600} sx={{ fontSize: "0.9375rem", wordBreak: "break-word", whiteSpace: "pre-line" }}>
              {screen.primary}
            </Typography>
            {screen.secondary && (
              <Typography variant="caption" color="text.secondary" sx={{ wordBreak: "break-all", opacity: 0.7 }}>
                {screen.secondary}
              </Typography>
            )}
          </Stack>
        ) : (
          <Stack spacing={0.65}>
            {screen.fields.map((f, i) => (
              <Stack key={i} direction="row" spacing={1} justifyContent="space-between" alignItems="baseline">
                <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                  {f.label}
                </Typography>
                <Typography
                  component="div"
                  variant="mono"
                  fontWeight={600}
                  sx={{ fontSize: "0.75rem", textAlign: "right", wordBreak: "break-word" }}
                >
                  {f.primary}
                </Typography>
              </Stack>
            ))}
          </Stack>
        )}
      </DeviceScreen>

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 0.5, opacity: status === "approved" ? 0.3 : 1, pointerEvents: status === "approved" ? "none" : "auto" }}>
        <IconButton
          size="small"
          aria-label="Previous screen"
          disabled={pageIndex === 0}
          onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
        >
          <ChevronLeftIcon fontSize="small" />
        </IconButton>
        <Typography variant="caption" color="text.secondary">
          {screens.length ? `${pageIndex + 1}/${screens.length}` : "—"}
        </Typography>
        <IconButton
          size="small"
          aria-label="Next screen"
          disabled={pageIndex >= screens.length - 1}
          onClick={() => setPageIndex((i) => Math.min(screens.length - 1, i + 1))}
        >
          <ChevronRightIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="center" sx={{ mt: 0.5, mb: 1 }}>
        {status === "pending" && <CircularProgress size={12} />}
        <Typography variant="caption" color="text.secondary">{STATUS_TEXT[status]}</Typography>
      </Stack>
    </Box>
  );
}
