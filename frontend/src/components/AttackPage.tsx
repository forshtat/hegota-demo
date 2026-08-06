import { Alert, Button, CircularProgress, Stack, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import { useWallet } from "../contexts/WalletContext.js";
import type { HegotaWalletScenario } from "../hegotaScenarios/types.js";
import HegotaNativeAttackView from "./hegotaWallet/HegotaNativeAttackView.js";
import PageContainer from "./layout/PageContainer.js";

export interface AttackPageProps {
  title: string;
  description: string;
  // `<any>`: this component only forwards the scenario to HegotaNativeAttackView, never reading
  // any TContext-shaped field itself, so it doesn't care which scenario's specific context type
  // this is -- same reasoning as HegotaWalletScenario's own `arm()` signature.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hegotaScenario: HegotaWalletScenario<any>;
}

export default function AttackPage({ title, description, hegotaScenario }: AttackPageProps) {
  const {
    isConnected, isHegota, chainId,
    switchToHegota, isSwitchingNetwork, switchNetworkError,
    addHegotaNetwork, isAddingNetwork, addNetworkError,
  } = useWallet();

  if (isConnected && isHegota) {
    return <HegotaNativeAttackView title={title} description={description} scenario={hegotaScenario} />;
  }

  return (
    <PageContainer>
      <Typography variant="h5" gutterBottom>{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>{description}</Typography>

      {!isConnected && (
        <Alert severity="warning" action={<appkit-button />}>
          Connect your wallet using the button in the sidebar to run this demo.
        </Alert>
      )}

      {isConnected && !isHegota && (
        <Stack spacing={1}>
          <Alert
            severity="error"
            action={
              <Stack direction="row" spacing={1}>
                <Button
                  color="inherit"
                  size="small"
                  startIcon={isAddingNetwork ? <CircularProgress size={14} color="inherit" /> : <AddIcon fontSize="small" />}
                  onClick={addHegotaNetwork}
                  disabled={isAddingNetwork || isSwitchingNetwork}
                >
                  {isAddingNetwork ? "Adding…" : "Add network"}
                </Button>
                <Button
                  color="inherit"
                  size="small"
                  startIcon={isSwitchingNetwork ? <CircularProgress size={14} color="inherit" /> : <SwapHorizIcon fontSize="small" />}
                  onClick={switchToHegota}
                  disabled={isAddingNetwork || isSwitchingNetwork}
                >
                  {isSwitchingNetwork ? "Switching…" : "Switch network"}
                </Button>
              </Stack>
            }
          >
            Wrong network (chain {chainId ?? "unknown"}). This demo runs on the Hegotá devnet — add or switch to it.
          </Alert>
          {(switchNetworkError || addNetworkError) && (
            <Alert severity="warning">{switchNetworkError ?? addNetworkError}</Alert>
          )}
        </Stack>
      )}
    </PageContainer>
  );
}
