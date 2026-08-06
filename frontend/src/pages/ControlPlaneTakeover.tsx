import AttackPage from "../components/AttackPage.js";
import { controlPlaneTakeoverScenario } from "../hegotaScenarios/controlPlaneTakeoverScenario.js";

const TITLE = "Safe control-plane takeover";
const NATIVE_DESCRIPTION = "A disguised Safe transaction actually DELEGATECALLs into a malicious contract that rewrites the Safe's own threshold and guard storage, wiping out its multisig protection. SafeControlPlaneAssertion reads those exact storage slots via TXTRACE in a POST_TX frame after the transaction executes, and reverts the whole transaction if either one changed.";

export default function ControlPlaneTakeover() {
  return (
    <AttackPage
      title={TITLE}
      description={NATIVE_DESCRIPTION}
      hegotaScenario={controlPlaneTakeoverScenario}
    />
  );
}
