import { useEffect, useState } from "react";
import { Alert, MenuItem, Paper, Select, Stack, Typography, type SelectChangeEvent } from "@mui/material";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import { formatEther } from "ethers";
import { useWallet } from "../../contexts/WalletContext.js";
import { getAutoWalletSnapshot, subscribeAutoWallet, selectAutoWalletAccount } from "../../devAutoWallet.js";
import DeviceScreen from "./DeviceScreen.js";
import WalletSimulatorHeader from "./WalletSimulatorHeader.js";

function short(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function PrivateSwapAccountPicker() {
  const { isDevAutoWallet, address, provider } = useWallet();
  const [snapshot, setSnapshot] = useState(() => getAutoWalletSnapshot());
  const [balance, setBalance] = useState<bigint | null>(null);

  useEffect(() => subscribeAutoWallet(() => setSnapshot(getAutoWalletSnapshot())), []);

  // No push event exists for balance changes, so re-poll whenever the account or provider
  // identity changes.
  useEffect(() => {
    if (!provider || !isDevAutoWallet) {
      setBalance(null);
      return;
    }
    let cancelled = false;
    const active = snapshot.accounts[snapshot.currentIndex]?.address;
    if (!active) return;
    provider.getBalance(active).then((b) => {
      if (!cancelled) setBalance(b);
    });
    return () => {
      cancelled = true;
    };
  }, [provider, isDevAutoWallet, snapshot]);

  function handleAccountChange(event: SelectChangeEvent<number>) {
    selectAutoWalletAccount(Number(event.target.value));
  }

  return (
    <Paper variant="outlined" sx={{ p: 0, overflow: "hidden" }}>
      <WalletSimulatorHeader icon={<AccountBalanceWalletIcon fontSize="small" />} title="Demo wallet" />

      {!isDevAutoWallet ? (
        <>
          <DeviceScreen>
            <Typography variant="mono" component="div" sx={{ fontSize: "0.8125rem" }}>
              Connected: {address ? short(address) : "—"}
            </Typography>
          </DeviceScreen>
          <Stack sx={{ px: 2, pb: 2 }}>
            <Alert severity="info">
              Account switching here only works with the built-in demo wallet. This tab is
              connected to a real wallet instead — switch accounts in its own extension.
            </Alert>
          </Stack>
        </>
      ) : (
        <>
          <DeviceScreen>
            <Typography variant="mono" component="div" sx={{ fontSize: "0.8125rem" }}>
              Active: {short(snapshot.accounts[snapshot.currentIndex]?.address ?? "")}
              <br />
              {balance === null ? "Balance: —" : `Balance: ${formatEther(balance)} ETH`}
            </Typography>
          </DeviceScreen>
          <Stack spacing={1.5} sx={{ px: 2, pb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Switching here fires a real account-change event, just like picking a different
              account in an actual wallet.
            </Typography>
            <Select size="small" value={snapshot.currentIndex} onChange={handleAccountChange}>
              {snapshot.accounts.map((account, index) => (
                <MenuItem key={account.address} value={index}>
                  Account {index + 1} — {short(account.address)}
                </MenuItem>
              ))}
            </Select>
            <Typography variant="body2" color="text.secondary">
              Deposits on the Public side are now a real transaction this account pays for
              itself — low on funds? Use the Faucet button in the sidebar's bottom-left corner.
            </Typography>
          </Stack>
        </>
      )}
    </Paper>
  );
}
