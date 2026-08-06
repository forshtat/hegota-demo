import type { ReactNode } from "react";
import { Stack, Typography } from "@mui/material";

export default function WalletSimulatorHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ px: 2, py: 1.5, bgcolor: "action.hover" }}>
      {icon}
      <Typography variant="subtitle2">{title}</Typography>
    </Stack>
  );
}
