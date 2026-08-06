import { Stack, Alert } from "@mui/material";
import GppBadIcon from "@mui/icons-material/GppBad";
import DataField from "../layout/DataField.js";
import type { ScenarioExplainer } from "../../hegotaScenarios/types.js";

export default function DecodedClaimSummary({ explainer }: { explainer: ScenarioExplainer }) {
  return (
    <Stack spacing={1.5}>
      <Stack spacing={1}>
        <DataField label="Action" value={explainer.action} mono={false} />
        <DataField label="Changes" value={explainer.changes} mono={false} />
      </Stack>
      <Alert severity="error" icon={<GppBadIcon fontSize="inherit" />}>
        {explainer.risk}
      </Alert>
    </Stack>
  );
}
