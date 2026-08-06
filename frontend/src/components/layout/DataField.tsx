import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

export type DataFieldTone = "neutral" | "success" | "warning" | "error";

const TONE_COLOR: Record<DataFieldTone, string> = {
  neutral: "text.primary",
  success: "success.main",
  warning: "warning.main",
  error: "error.main",
};

export default function DataField({
  label,
  value,
  tone = "neutral",
  mono = true,
  layout = "row",
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: DataFieldTone;
  mono?: boolean;
  layout?: "row" | "column";
}) {
  const valueColor = TONE_COLOR[tone];

  if (layout === "column") {
    return (
      <Stack spacing={0.5}>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: "uppercase", letterSpacing: 1 }}>
          {label}
        </Typography>
        <Typography
          variant={mono ? "mono" : "body2"}
          fontWeight={600}
          color={valueColor}
          sx={{ wordBreak: "break-word", whiteSpace: "pre-line" }}
        >
          {value}
        </Typography>
      </Stack>
    );
  }

  return (
    <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="baseline">
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography
        variant={mono ? "mono" : "body2"}
        fontWeight={600}
        color={valueColor}
        sx={{ textAlign: "right", maxWidth: "70%", wordBreak: "break-word" }}
      >
        {value}
      </Typography>
    </Stack>
  );
}
