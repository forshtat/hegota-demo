import { Box } from "@mui/material";
import type { ReactNode } from "react";

// Fixed height, overflow hidden: a real hardware wallet screen doesn't scroll. Content that
// doesn't fit must be pre-formatted to fit (see hardwareWalletFormat.ts) rather than relying
// on this component to scroll it into view.
const SCREEN_HEIGHT = 172;

export default function DeviceScreen({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        m: 2,
        p: 1.5,
        borderRadius: 2,
        bgcolor: "background.elevated",
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      <Box
        sx={{
          bgcolor: "background.default",
          color: "text.primary",
          borderRadius: 1,
          p: 2,
          height: SCREEN_HEIGHT,
          overflow: "hidden",
        }}
      >
        {children}
      </Box>
    </Box>
  );
}
