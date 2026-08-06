import { Box, Drawer } from "@mui/material";
import { useLocation } from "react-router-dom";
import { useHegotaWalletPanel } from "../../contexts/HegotaWalletPanelContext.js";
import { useTour } from "../../contexts/TourContext.js";
import { tourStops } from "../../tourStops.js";
import type { PostTxRunResult } from "../../hegotaWallet.js";
import WalletSimulatorPanel from "./WalletSimulatorPanel.js";
import PrivateSwapAccountPicker from "./PrivateSwapAccountPicker.js";

export const WALLET_SIMULATOR_DRAWER_WIDTH = 380;

export default function WalletSimulatorDrawer() {
  const { isOpen, mode, scenario } = useHegotaWalletPanel();
  const { markComplete } = useTour();
  const location = useLocation();

  // Only stops flagged requiresAction earn their checkmark this way -- a page like Clear
  // Signing also hosts a live demo but isn't flagged, so running its demo must not mark it
  // complete; it stays a static stop, completed via scroll-to-bottom + Next like any other.
  function handleDone(result: PostTxRunResult, violationArmed: boolean) {
    const stop = tourStops.find((s) => s.path === location.pathname);
    if (stop?.requiresAction && result.outcome === "reverted" && violationArmed) {
      markComplete(stop.path);
    }
  }

  return (
    <Drawer
      anchor="right"
      variant="persistent"
      open={isOpen}
      sx={{
        width: WALLET_SIMULATOR_DRAWER_WIDTH,
        flexShrink: 0,
        "& .MuiDrawer-paper": { width: WALLET_SIMULATOR_DRAWER_WIDTH, boxSizing: "border-box" },
      }}
    >
      <Box sx={{ p: 2 }}>
        {mode === "scenario" && <WalletSimulatorPanel scenario={scenario} onDone={handleDone} />}
        {mode === "accountPicker" && <PrivateSwapAccountPicker />}
      </Box>
    </Drawer>
  );
}
