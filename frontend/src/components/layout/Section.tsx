import { Paper, Stack, Typography, type SxProps, type Theme } from "@mui/material";
import type { ReactNode } from "react";

export default function Section({
  title,
  icon,
  action,
  children,
  sx,
}: {
  title?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  sx?: SxProps<Theme>;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 3, mb: 3, ...sx }}>
      {(title || icon || action) && (
        <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            {icon}
            {title && <Typography variant="h6">{title}</Typography>}
          </Stack>
          {action}
        </Stack>
      )}
      {children}
    </Paper>
  );
}
