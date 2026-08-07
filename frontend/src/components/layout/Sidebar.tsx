import { useState } from "react";
import {
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  Divider,
  Box,
  Button,
  Stack,
  CircularProgress,
} from "@mui/material";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import WaterDropIcon from "@mui/icons-material/WaterDrop";
import HomeIcon from "@mui/icons-material/Home";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import MapIcon from "@mui/icons-material/Map";
import GppMaybeIcon from "@mui/icons-material/GppMaybe";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import DrawIcon from "@mui/icons-material/Draw";
import LockIcon from "@mui/icons-material/Lock";
import type { ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useTour } from "../../contexts/TourContext.js";
import { useWallet } from "../../contexts/WalletContext.js";
import { appKit } from "../../wallet.js";
import { HEGOTA_CHAIN_ID } from "../../hegotaWallet.js";
import { claimHegotaFaucet } from "../../hegotaAccountFunding.js";
import { formatWalletError } from "../../errorFormat.js";
import { useTxToast } from "../../toast.js";

// The official public faucet controls the claim amount itself (currently 1 ETH per claim,
// per https://faucet.hegota.ethrex.xyz's docs) -- not something this app configures.
const FAUCET_DISPLAY_AMOUNT = "1 ETH";

const DRAWER_WIDTH = 260;
const NAV_ICON_SX = { fontSize: 16 };

const DOCUMENTATION_ITEMS = [
  { path: "/",                    label: "Welcome",            icon: <HomeIcon         sx={NAV_ICON_SX} /> },
  { path: "/eip-7906-explained",  label: "EIP-7906 Explained", icon: <InfoOutlinedIcon sx={NAV_ICON_SX} /> },
  { path: "/clear-signing",       label: "Architecture",       icon: <DrawIcon         sx={NAV_ICON_SX} /> },
  { path: "/legacy-frameworks",   label: "Existing Frameworks", icon: <MenuBookIcon    sx={NAV_ICON_SX} /> },
];

const LIVE_DEMO_ITEMS = [
  { path: "/demo",                   label: "Demo Overview",           icon: <MapIcon sx={NAV_ICON_SX} /> },
  { path: "/account-setup",          label: "Set Up Your Account",     icon: <AccountBalanceWalletIcon sx={NAV_ICON_SX} /> },
  { path: "/control-plane-takeover", label: "Control-Plane Takeover",  icon: <AdminPanelSettingsIcon sx={NAV_ICON_SX} /> },
  { path: "/mev-sandwich",           label: "MEV Sandwich",            icon: <ShowChartIcon sx={NAV_ICON_SX} /> },
  { path: "/oracle-manipulation",    label: "Oracle Manipulation",     icon: <ManageSearchIcon sx={NAV_ICON_SX} /> },
  { path: "/unlimited-approval",     label: "Unlimited Approval",      icon: <GppMaybeIcon sx={NAV_ICON_SX} /> },
  { path: "/hidden-eth-drain",       label: "Hidden ETH Drain",        icon: <AccountBalanceWalletIcon sx={NAV_ICON_SX} /> },
  { path: "/proxy-swap",             label: "Proxy Impl Swap",         icon: <AutorenewIcon sx={NAV_ICON_SX} /> },
];

const BONUS_ITEMS = [
  { path: "/private-swap", label: "Private Swap", icon: <LockIcon sx={NAV_ICON_SX} /> },
];

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Typography variant="overline" color="text.disabled" sx={{ px: 2, pt: 1.25, pb: 0.25, display: "block" }}>
      {children}
    </Typography>
  );
}

function NavIcon({ icon, done }: { icon: ReactNode; done: boolean }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        borderRadius: "50%",
        border: "1.5px solid",
        borderColor: done ? "success.main" : "transparent",
        color: "text.secondary",
        transition: "border-color 0.3s ease",
      }}
    >
      {icon}
    </Box>
  );
}

export default function Sidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { completedPaths, resetProgress } = useTour();
  const { isConnected, isHegota, address } = useWallet();
  const { notifyMined, notifyError } = useTxToast();
  const [faucetBusy, setFaucetBusy] = useState(false);

  const showFaucet = isConnected && isHegota;

  const nav = (path: string) => () => navigate(path);
  const sel = (path: string) => location.pathname === path;

  async function handleFaucet() {
    if (!address) return;
    setFaucetBusy(true);
    try {
      await claimHegotaFaucet(address);
      // The faucet's transfer happens server-side (we get no txHash to await), and AppKit
      // never sees it as a pending transaction either way -- give it one slot (6s, see the
      // Hegotá devnet's own docs) before refreshing the balance, then notify regardless of
      // whether it landed by then, since the claim itself did succeed.
      await new Promise((r) => setTimeout(r, 8000));
      await appKit.updateNativeBalance(address, HEGOTA_CHAIN_ID, "eip155");
      notifyMined(`Faucet claimed (${FAUCET_DISPLAY_AMOUNT})`, "success");
    } catch (e) {
      notifyError(`Faucet claim failed — ${formatWalletError(e)}`);
    } finally {
      setFaucetBusy(false);
    }
  }

  function handleRestart() {
    resetProgress();
    navigate("/");
  }

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: DRAWER_WIDTH,
        flexShrink: 0,
        "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box" },
      }}
    >
      <Toolbar sx={{ flexDirection: "column", alignItems: "flex-start", justifyContent: "center", py: 1.5, minHeight: "auto !important" }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
          EIP-7906
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35, display: "block", mt: 0.25 }}>
          Post-Transaction Assertions &amp; Trustless Clear Signing
        </Typography>
      </Toolbar>
      <Divider />
      <List dense sx={{ pt: 0.5 }}>

        <SectionLabel>Documentation</SectionLabel>
        {DOCUMENTATION_ITEMS.map(({ path, label, icon }) => {
          const done = completedPaths.has(path);
          const isSelected = sel(path);
          return (
            <ListItemButton key={path} selected={isSelected} onClick={nav(path)} sx={{ pl: 2.5 }}>
              <ListItemIcon sx={{ minWidth: 34 }}>
                <NavIcon icon={icon} done={done} />
              </ListItemIcon>
              <ListItemText
                primary={label}
                primaryTypographyProps={{ fontSize: 12, color: done && !isSelected ? "text.secondary" : undefined }}
              />
            </ListItemButton>
          );
        })}

        <Divider sx={{ my: 0.75 }} />

        <SectionLabel>Live Demo</SectionLabel>
        {LIVE_DEMO_ITEMS.map(({ path, label, icon }) => {
          const done = completedPaths.has(path);
          const isSelected = sel(path);
          return (
            <ListItemButton key={path} selected={isSelected} onClick={nav(path)} sx={{ pl: 2.5 }}>
              <ListItemIcon sx={{ minWidth: 34 }}>
                <NavIcon icon={icon} done={done} />
              </ListItemIcon>
              <ListItemText
                primary={label}
                primaryTypographyProps={{ fontSize: 13, color: done && !isSelected ? "text.secondary" : undefined }}
              />
            </ListItemButton>
          );
        })}

        <Divider sx={{ my: 0.75 }} />

        <SectionLabel>Bonus</SectionLabel>
        {BONUS_ITEMS.map(({ path, label, icon }) => {
          const done = completedPaths.has(path);
          const isSelected = sel(path);
          return (
            <ListItemButton key={path} selected={isSelected} onClick={nav(path)} sx={{ pl: 2.5 }}>
              <ListItemIcon sx={{ minWidth: 34 }}>
                <NavIcon icon={icon} done={done} />
              </ListItemIcon>
              <ListItemText
                primary={label}
                primaryTypographyProps={{ fontSize: 13, color: done && !isSelected ? "text.secondary" : undefined }}
              />
            </ListItemButton>
          );
        })}

      </List>

      <Box sx={{ mt: "auto", p: 2, borderTop: 1, borderColor: "divider" }}>
        <Stack spacing={1}>
          <Button
            fullWidth
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={<RestartAltIcon fontSize="small" />}
            onClick={handleRestart}
            sx={{ color: "text.secondary", borderColor: "divider" }}
          >
            Restart tour
          </Button>
          {showFaucet && (
            <Button
              fullWidth
              size="small"
              variant="outlined"
              color="inherit"
              startIcon={faucetBusy ? <CircularProgress size={14} /> : <WaterDropIcon fontSize="small" />}
              disabled={faucetBusy}
              onClick={handleFaucet}
              sx={{ color: "text.secondary", borderColor: "divider" }}
            >
              {faucetBusy ? "Claiming…" : `Faucet +${FAUCET_DISPLAY_AMOUNT}`}
            </Button>
          )}
          <appkit-button />
        </Stack>
      </Box>
    </Drawer>
  );
}
