import { Box } from "@mui/material";
import type { ReactNode } from "react";

export default function PageContainer({
  children,
  maxWidth = "default",
}: {
  children: ReactNode;
  maxWidth?: "default" | "wide";
}) {
  return (
    <Box
      sx={{
        maxWidth: maxWidth === "wide" ? 1280 : 1080,
        mx: "auto",
        py: 4,
        px: 3,
      }}
    >
      {children}
    </Box>
  );
}
