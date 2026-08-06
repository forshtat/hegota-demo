import { Box } from "@mui/material";
import type { ReactNode } from "react";

export default function EnforcementRow({
  label,
  value,
  color,
}: {
  label: string;
  value: ReactNode;
  color?: string;
}) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <strong style={{ fontStyle: "italic", color }}>{value}</strong>
    </Box>
  );
}
