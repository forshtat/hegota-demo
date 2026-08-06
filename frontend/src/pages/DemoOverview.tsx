import { Typography, Stack } from "@mui/material";
import SecurityIcon from "@mui/icons-material/Security";
import GppMaybeIcon from "@mui/icons-material/GppMaybe";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import ShowChartIcon from "@mui/icons-material/ShowChart";
import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import AutorenewIcon from "@mui/icons-material/Autorenew";
import { useNavigate } from "react-router-dom";
import PageContainer from "../components/layout/PageContainer.js";
import Section from "../components/layout/Section.js";
import ListRow from "../components/layout/ListRow.js";

const THREATS = [
  { num: 1, icon: <AdminPanelSettingsIcon sx={{ fontSize: 18 }} />,   name: "Safe control-plane takeover",  desc: "Models the February 2025 Bybit hack — a compromised signing UI disguises a Safe threshold hijack as a routine transfer. The on-chain POST_TX assertion, not the wallet's decode step, is what actually stops it from finalizing.", path: "/control-plane-takeover" },
  { num: 2, icon: <GppMaybeIcon sx={{ fontSize: 18 }} />,             name: "Unlimited token approval",     desc: "A dApp sets type(uint256).max approval — ERC-20 Approval event detected and capped.",         path: "/unlimited-approval" },
  { num: 3, icon: <AccountBalanceWalletIcon sx={{ fontSize: 18 }} />, name: "Hidden ETH drain in multicall",desc: "A hidden multicall leg sends ETH to an attacker — unauthorized balance increase detected.",   path: "/hidden-eth-drain" },
  { num: 4, icon: <ShowChartIcon sx={{ fontSize: 18 }} />,            name: "MEV sandwich",                 desc: "Bot front-runs a swap — actual Transfer output falls below signed minimum.",                 path: "/mev-sandwich" },
  { num: 5, icon: <ManageSearchIcon sx={{ fontSize: 18 }} />,         name: "Oracle manipulation",          desc: "Oracle is manipulated after signing — same minimum-output check catches it.",                path: "/oracle-manipulation" },
  { num: 6, icon: <AutorenewIcon sx={{ fontSize: 18 }} />,            name: "Proxy implementation swap",    desc: "Multisig approves a malicious upgrade — write to EIP-1967 slot detected.",                   path: "/proxy-swap" },
];

export default function DemoOverview() {
  const navigate = useNavigate();

  return (
    <PageContainer>
      <Typography variant="h4" gutterBottom>
        Demo overview
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 4 }}>
        Six attack patterns that EIP-7906 can mitigate, each run live on the Hegotá devnet
        through your own connected wallet.
      </Typography>

      <Section title="Attack scenarios" icon={<SecurityIcon color="primary" fontSize="small" />} sx={{ mb: 0 }}>
        <Stack spacing={1.25}>
          {THREATS.map(({ num, icon, name, desc, path }) => (
            <ListRow key={num} icon={icon} title={name} description={desc} onClick={() => navigate(path)} />
          ))}
        </Stack>
      </Section>
    </PageContainer>
  );
}
