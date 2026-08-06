import { Alert, Button, Stack, Typography } from "@mui/material";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { Link as RouterLink } from "react-router-dom";
import { useHegotaWalletPanel } from "../../contexts/HegotaWalletPanelContext.js";
import { useErc7579Account } from "../../hooks/useErc7579Account.js";
import { useSafeAccount } from "../../hooks/useSafeAccount.js";
import type { HegotaWalletScenario } from "../../hegotaScenarios/types.js";
import PageContainer from "../layout/PageContainer.js";
import Section from "../layout/Section.js";
import DecodedClaimSummary from "./DecodedClaimSummary.js";

export interface HegotaNativeAttackViewProps {
  title: string;
  description: string;
  // `<any>`: this component only ever reads accountKind/decodedDescription()/violationToggle --
  // none of them TContext-shaped -- and otherwise just hands the scenario to arm(), so it
  // doesn't care which scenario's specific context type this is.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scenario: HegotaWalletScenario<any>;
}

export default function HegotaNativeAttackView({ title, description, scenario }: HegotaNativeAttackViewProps) {
  const { arm, scenario: armedScenario, options: armedOptions, isOpen } = useHegotaWalletPanel();
  // Both hooks are called unconditionally (rules of hooks) even though only one side's
  // result is used, based on scenario.accountKind.
  const erc7579 = useErc7579Account();
  const safe = useSafeAccount();
  const ready = scenario.accountKind === "safe" ? safe.isDeployed : erc7579.isDeployed && erc7579.isFunded;

  const isArmedHere = isOpen && armedScenario === scenario;
  const activeVariant = isArmedHere ? (armedOptions?.triggerViolation ? "attack" : "compliant") : null;

  return (
    <PageContainer>
      <Typography variant="h5" gutterBottom>{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>{description}</Typography>

      <Section
        title="What you see"
        icon={<ChatBubbleOutlineIcon color="primary" fontSize="small" />}
        sx={{ mb: 2 }}
      >
        <DecodedClaimSummary explainer={scenario.decodedDescription()} />
      </Section>

      {!ready && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {scenario.accountKind === "safe"
            ? "This scenario runs through your personal demo Safe (step 3 of account setup), which isn't deployed yet — "
            : "This scenario runs through your ERC-7579 smart account, which isn't deployed and funded yet (steps 1–2 of account setup) — "}
          <RouterLink to="/account-setup">go to account setup</RouterLink>.
        </Alert>
      )}

      <Stack direction="row" spacing={2}>
        {scenario.violationToggle ? (
          <>
            <Button
              variant={activeVariant && activeVariant !== "compliant" ? "outlined" : "contained"}
              color={activeVariant === "compliant" ? "primary" : "inherit"}
              startIcon={activeVariant === "compliant" ? <CheckCircleIcon fontSize="small" /> : undefined}
              disabled={!ready}
              onClick={() => arm(scenario, { triggerViolation: false })}
            >
              {activeVariant === "compliant" ? "Armed — compliant" : "Try it with your wallet (compliant)"}
            </Button>
            <Button
              variant={activeVariant && activeVariant !== "attack" ? "outlined" : "contained"}
              color={activeVariant === "attack" ? "error" : "inherit"}
              startIcon={activeVariant === "attack" ? <CheckCircleIcon fontSize="small" /> : undefined}
              disabled={!ready}
              onClick={() => arm(scenario, { triggerViolation: true })}
            >
              {activeVariant === "attack" ? "Armed — attack" : "Try it with your wallet (attack)"}
            </Button>
          </>
        ) : (
          <Button variant="contained" disabled={!ready} onClick={() => arm(scenario)}>
            Try it with your wallet
          </Button>
        )}
      </Stack>
    </PageContainer>
  );
}
