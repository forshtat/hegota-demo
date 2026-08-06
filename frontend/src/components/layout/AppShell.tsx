import { useEffect } from "react";
import { Box } from "@mui/material";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar.js";
import TourBar from "./TourBar.js";
import WalletSimulatorDrawer, { WALLET_SIMULATOR_DRAWER_WIDTH } from "../hegotaWallet/WalletSimulatorDrawer.js";
import { useHegotaWalletPanel } from "../../contexts/HegotaWalletPanelContext.js";
import { useTour } from "../../contexts/TourContext.js";

const SCROLL_BOTTOM_THRESHOLD_PX = 24;

export default function AppShell() {
  const { isOpen } = useHegotaWalletPanel();
  const { reportScrolledToBottom } = useTour();
  const location = useLocation();
  // The Private Swap page isn't a tour stop (see tourStops.ts) -- the bar can only ever show
  // its idle "not on tour" message there, and its flat background.paper strip cuts across the
  // page's own full-bleed red/green design.
  const showTourBar = location.pathname !== "/private-swap";

  useEffect(() => {
    // react-router doesn't reset scroll position on navigation. Without this, leaving a long
    // page scrolled to the bottom (which the tour now encourages, to earn a checkmark) lands the
    // next, shorter page's viewport scrolled past its own content -- it looks blank.
    window.scrollTo(0, 0);
    // The outer shell only sets minHeight: 100vh (not a fixed height), so `main`'s own
    // overflow:auto never actually clips -- the real scrolling happens on the document/window,
    // not inside `main`. Track scroll position there instead.
    function checkScrolledToBottom() {
      const doc = document.documentElement;
      const distanceFromBottom = doc.scrollHeight - window.scrollY - doc.clientHeight;
      if (distanceFromBottom < SCROLL_BOTTOM_THRESHOLD_PX) {
        reportScrolledToBottom(location.pathname);
      }
    }
    window.addEventListener("scroll", checkScrolledToBottom, { passive: true });
    // A page short enough to need no scrolling should still count as "read to the end" --
    // check once after the new page paints, not just on scroll events.
    const id = requestAnimationFrame(checkScrolledToBottom);
    return () => {
      window.removeEventListener("scroll", checkScrolledToBottom);
      cancelAnimationFrame(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar />
      <Box
        sx={{
          flexGrow: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          transition: (theme) =>
            theme.transitions.create("margin", {
              easing: theme.transitions.easing.sharp,
              duration: isOpen ? theme.transitions.duration.enteringScreen : theme.transitions.duration.leavingScreen,
            }),
          marginRight: isOpen ? 0 : `-${WALLET_SIMULATOR_DRAWER_WIDTH}px`,
        }}
      >
        {showTourBar && <TourBar />}
        <Box component="main" sx={{ flexGrow: 1, overflow: "auto" }}>
          <Outlet />
        </Box>
      </Box>
      <WalletSimulatorDrawer />
    </Box>
  );
}
