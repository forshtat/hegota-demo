import type { ReactNode } from "react";
import { Typography } from "@mui/material";
import DeviceScreen from "./DeviceScreen.js";

export default function DeviceStatusText({ children }: { children: ReactNode }) {
  return (
    <DeviceScreen>
      <Typography variant="mono" component="div" sx={{ fontSize: "0.8125rem" }}>
        {children}
      </Typography>
    </DeviceScreen>
  );
}
