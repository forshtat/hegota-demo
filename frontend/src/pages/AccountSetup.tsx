import { useEffect } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import { formatEther } from "ethers";
import AccountBalanceWalletIcon from "@mui/icons-material/AccountBalanceWallet";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import AddIcon from "@mui/icons-material/Add";
import ShieldIcon from "@mui/icons-material/Shield";
import WifiOffIcon from "@mui/icons-material/WifiOff";
import { useWallet } from "../contexts/WalletContext.js";
import { useTour } from "../contexts/TourContext.js";
import { useErc7579Account } from "../hooks/useErc7579Account.js";
import { useSafeAccount } from "../hooks/useSafeAccount.js";
import { useAdvisoryBalance } from "../hooks/useAdvisoryBalance.js";
import PageContainer from "../components/layout/PageContainer.js";
import DoraLink from "../components/DoraLink.js";

export default function AccountSetup() {
  const {
    isConnected, isHegota, chainId, provider, address, isDevAutoWallet,
    switchToHegota, isSwitchingNetwork, switchNetworkError,
    addHegotaNetwork, isAddingNetwork, addNetworkError,
  } = useWallet();
  const {
    configured,
    accountAddress,
    isDeployed,
    isProvisioning,
    provisionError,
    provisionTxHash,
    provision,
    isFunded,
    isFunding,
    fundError,
    fundTxHash,
    approveTxHash,
    fund,
  } = useErc7579Account();
  const {
    configured: safeConfigured,
    safeAddress,
    isDeployed: isSafeDeployed,
    isProvisioning: isSafeProvisioning,
    provisionError: safeProvisionError,
    provisionTxHash: safeProvisionTxHash,
    provision: provisionSafe,
  } = useSafeAccount();
  const { markComplete } = useTour();

  const accountBalance = useAdvisoryBalance(provider, isDevAutoWallet, accountAddress);
  const eoaBalance = useAdvisoryBalance(provider, isDevAutoWallet, address);

  useEffect(() => {
    if ((isDeployed && isFunded) || isSafeDeployed) {
      markComplete("/account-setup");
    }
  }, [isDeployed, isFunded, isSafeDeployed, markComplete]);

  const onHegota = isConnected && isHegota;

  return (
    <PageContainer>
      <Typography variant="h4" gutterBottom>
        Set up your account
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Provision a real ERC-7579 smart account owned by your connected wallet, then fund
        and approve it so it's ready to run the live scenarios on Hegotá.
      </Typography>

      {!isConnected && (
        <Alert
          severity="warning"
          sx={{ mb: 3, alignItems: "center", "& .MuiAlert-action": { alignItems: "center", pt: 0 } }}
          action={<appkit-button />}
        >
          Connect your wallet to set up your account.
        </Alert>
      )}

      {isConnected && !onHegota && (
        <Paper variant="outlined" sx={{ p: 3, mb: 3, borderColor: "error.main" }}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
            <WifiOffIcon color="error" />
            <Typography variant="h6">
              Wrong network
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
            Your wallet is connected to chain {chainId ?? "unknown"}. This demo runs on the
            Hegotá devnet — switch to it below. If your wallet doesn't already know about
            Hegotá, add it first.
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <Button
              variant="contained"
              startIcon={isSwitchingNetwork ? <CircularProgress size={16} color="inherit" /> : <SwapHorizIcon />}
              onClick={switchToHegota}
              disabled={isSwitchingNetwork || isAddingNetwork}
            >
              {isSwitchingNetwork ? "Switching..." : "Switch to Hegotá"}
            </Button>
            <Button
              variant="outlined"
              color="inherit"
              startIcon={isAddingNetwork ? <CircularProgress size={16} /> : <AddIcon />}
              onClick={addHegotaNetwork}
              disabled={isSwitchingNetwork || isAddingNetwork}
            >
              {isAddingNetwork ? "Adding..." : "Add Hegotá to wallet"}
            </Button>
          </Stack>
          {(switchNetworkError || addNetworkError) && (
            <Alert severity="warning" sx={{ mt: 1.5 }}>{switchNetworkError ?? addNetworkError}</Alert>
          )}
        </Paper>
      )}

      {isConnected && onHegota && !configured && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Hegotá ERC-7579 account infrastructure is not configured. Run{" "}
          <code>npm run deploy:hegota</code> from the project root to populate{" "}
          <code>frontend/.env</code>.
        </Alert>
      )}

      {onHegota && configured && (
        <Stack spacing={3}>
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
              <AccountBalanceWalletIcon color="primary" />
              <Typography variant="h6">
                Step 1 — Provision your smart account
              </Typography>
            </Stack>
            {accountAddress && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Address (deterministic, per owner)
                </Typography>
                <Typography component="div" variant="mono" sx={{ wordBreak: "break-all" }}>
                  {accountAddress}
                </Typography>
              </Box>
            )}
            {isDeployed ? (
              <Box>
                <Chip label="Deployed" color="success" size="small" />
                {provisionTxHash && <DoraLink txHash={provisionTxHash} />}
              </Box>
            ) : (
              <Stack spacing={1.5} alignItems="flex-start">
                <Typography variant="body2" color="text.secondary">
                  {isDevAutoWallet
                    ? "Not deployed yet. Your Demo Wallet account pays for its own deployment: " +
                      "clicking below claims Hegotá ETH from the faucet straight to its " +
                      "(not-yet-deployed) address, then submits a real EIP-8141 frame " +
                      "transaction it signs and pays for itself, with no relay involved."
                    : "Not deployed yet. Deployment gas is sponsored — you don't need Hegotá ETH " +
                      "for this step — but your wallet will ask you to confirm before it deploys."}
                </Typography>
                {isDevAutoWallet && accountAddress && (
                  <Typography variant="caption" color="text.secondary">
                    Balance: {accountBalance === null ? "—" : `${formatEther(accountBalance)} ETH`}
                  </Typography>
                )}
                <Button
                  variant="outlined"
                  startIcon={isProvisioning ? <CircularProgress size={16} /> : <AccountBalanceWalletIcon />}
                  disabled={isProvisioning}
                  onClick={provision}
                >
                  {isProvisioning ? (isDevAutoWallet ? "Claiming & deploying..." : "Confirm in wallet...") : "Set up my account"}
                </Button>
                {provisionError && <Alert severity="error">{provisionError}</Alert>}
              </Stack>
            )}
          </Paper>

          <Divider />

          <Paper variant="outlined" sx={{ p: 3 }}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
              <SwapHorizIcon color="primary" />
              <Typography variant="h6">
                Step 2 — Fund &amp; approve
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {isDevAutoWallet
                ? "Your account mints its own input token, then approves MockSwap to spend " +
                  "it — one real frame transaction, paid from the account's own balance " +
                  "claimed in Step 1."
                : "Sends your account a fixed amount of the swap's input token, then approves " +
                  "MockSwap to spend it — both sponsored by the relay key."}
            </Typography>
            {isFunded ? (
              <Box>
                <Chip label="Funded & approved" color="success" size="small" />
                {fundTxHash && <DoraLink txHash={fundTxHash} />}
                {!isDevAutoWallet && approveTxHash && <DoraLink txHash={approveTxHash} />}
              </Box>
            ) : (
              <Stack spacing={1.5} alignItems="flex-start">
                <Typography variant="body2" color="text.secondary">
                  {isDevAutoWallet
                    ? "One frame transaction, signed and paid for by the account itself — no relay involved."
                    : "Two wallet confirmations: one to send the funds, one to approve MockSwap — " +
                      "gas for both is sponsored."}
                </Typography>
                <Button
                  variant="outlined"
                  startIcon={isFunding ? <CircularProgress size={16} /> : <SwapHorizIcon />}
                  disabled={!isDeployed || isFunding}
                  onClick={fund}
                >
                  {isFunding ? "Confirm in wallet..." : "Fund & approve"}
                </Button>
                {fundError && <Alert severity="error">{fundError}</Alert>}
              </Stack>
            )}
          </Paper>
        </Stack>
      )}

      {isConnected && onHegota && !safeConfigured && (
        <Alert severity="error" sx={{ mt: 3 }}>
          Hegotá Safe infrastructure is not configured. The Safe singleton + SafeProxyFactory
          need to be deployed and added to <code>frontend/.env</code> as{" "}
          <code>VITE_HEGOTA_SAFE_SINGLETON</code>/<code>VITE_HEGOTA_SAFE_PROXY_FACTORY</code>.
        </Alert>
      )}

      {onHegota && safeConfigured && (
        <>
          <Divider sx={{ my: 3 }} />
          <Paper variant="outlined" sx={{ p: 3 }}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
              <ShieldIcon color="primary" />
              <Typography variant="h6">
                Step 3 — Provision your personal demo Safe
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              A real, 1-of-1 Gnosis Safe owned solely by your connected wallet, used by the
              Control-Plane Takeover scenario. Independent of steps 1-2 above — you can do
              this before or after setting up your ERC-7579 account.
            </Typography>
            {safeAddress && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">
                  Address (deterministic, per owner)
                </Typography>
                <Typography component="div" variant="mono" sx={{ wordBreak: "break-all" }}>
                  {safeAddress}
                </Typography>
              </Box>
            )}
            {isSafeDeployed ? (
              <Box>
                <Chip label="Deployed" color="success" size="small" />
                {safeProvisionTxHash && <DoraLink txHash={safeProvisionTxHash} />}
              </Box>
            ) : (
              <Stack spacing={1.5} alignItems="flex-start">
                <Typography variant="body2" color="text.secondary">
                  {isDevAutoWallet
                    ? "Not deployed yet. Paid from your Demo Wallet's own Hegotá ETH via a real " +
                      "frame transaction it signs and pays for itself — claim some from the " +
                      "Faucet button in the sidebar first if you haven't."
                    : "Not deployed yet. Deployment gas is sponsored — you don't need Hegotá ETH " +
                      "for this step — but your wallet will ask you to confirm before it deploys."}
                </Typography>
                {isDevAutoWallet && address && (
                  <Typography variant="caption" color="text.secondary">
                    Your balance: {eoaBalance === null ? "—" : `${formatEther(eoaBalance)} ETH`}
                  </Typography>
                )}
                {isDevAutoWallet && eoaBalance === 0n && (
                  <Alert severity="warning" sx={{ width: "100%" }}>
                    No Hegotá ETH yet — claim some from the Faucet button in the sidebar first.
                  </Alert>
                )}
                <Button
                  variant="outlined"
                  startIcon={isSafeProvisioning ? <CircularProgress size={16} /> : <ShieldIcon />}
                  disabled={isSafeProvisioning}
                  onClick={provisionSafe}
                >
                  {isSafeProvisioning ? "Confirm in wallet..." : "Set up my Safe"}
                </Button>
                {safeProvisionError && <Alert severity="error">{safeProvisionError}</Alert>}
              </Stack>
            )}
          </Paper>
        </>
      )}
    </PageContainer>
  );
}
