import { createBrowserRouter, RouterProvider, Outlet } from "react-router-dom";
import AppShell from "./components/layout/AppShell.js";
import { HegotaWalletPanelProvider } from "./contexts/HegotaWalletPanelContext.js";
import { TourProvider } from "./contexts/TourContext.js";
import Welcome from "./pages/Welcome.js";
import EIP7906Explained from "./pages/EIP7906Explained.js";
import DemoOverview from "./pages/DemoOverview.js";
import UnlimitedApproval from "./pages/UnlimitedApproval.js";
import ControlPlaneTakeover from "./pages/ControlPlaneTakeover.js";
import HiddenETHDrain from "./pages/HiddenETHDrain.js";
import MEVSandwich from "./pages/MEVSandwich.js";
import OracleManipulation from "./pages/OracleManipulation.js";
import ProxySwap from "./pages/ProxySwap.js";
import TxDetail from "./pages/TxDetail.js";
import ContractDetail from "./pages/ContractDetail.js";
import MitigationReference from "./pages/MitigationReference.js";
import ClearSigning from "./pages/ClearSigning.js";
import AccountSetup from "./pages/AccountSetup.js";
import PrivateSwap from "./pages/PrivateSwap.js";

// HegotaWalletPanelProvider tracks the pathname via useLocation(), which only works for a
// descendant of the router — so it has to live inside the routed tree (wrapping every route's
// Outlet), not outside RouterProvider the way WalletProvider wraps <App/> in main.tsx.
function RootProviders() {
  return (
    <HegotaWalletPanelProvider>
      <TourProvider>
        <Outlet />
      </TourProvider>
    </HegotaWalletPanelProvider>
  );
}

const router = createBrowserRouter([
  {
    element: <RootProviders />,
    children: [
      { path: "/tx/:hash", element: <TxDetail /> },
      {
        path: "/",
        element: <AppShell />,
        children: [
          { index: true, element: <Welcome /> },
          { path: "eip-7906-explained", element: <EIP7906Explained /> },
          { path: "demo", element: <DemoOverview /> },
          { path: "unlimited-approval",       element: <UnlimitedApproval /> },
          { path: "control-plane-takeover",   element: <ControlPlaneTakeover /> },
          { path: "hidden-eth-drain",         element: <HiddenETHDrain /> },
          { path: "mev-sandwich",             element: <MEVSandwich /> },
          { path: "oracle-manipulation",       element: <OracleManipulation /> },
          { path: "proxy-swap",               element: <ProxySwap /> },
          { path: "contract/:address",         element: <ContractDetail /> },
          { path: "legacy-frameworks",        element: <MitigationReference /> },
          { path: "clear-signing",            element: <ClearSigning /> },
          { path: "account-setup",            element: <AccountSetup /> },
          { path: "private-swap",             element: <PrivateSwap /> },
        ],
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
