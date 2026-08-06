import AttackPage from "../components/AttackPage.js";
import { unlimitedApprovalScenario } from "../hegotaScenarios/unlimitedApprovalScenario.js";

const TITLE = "Unlimited token approval drain";
const DESCRIPTION = "A dApp tricks users into signing type(uint256).max approval, letting the contract drain their entire token balance at any future time. Each framework's policy contract scans TXTRACE Approval events and reverts if the approved amount exceeds a configured maximum.";

export default function UnlimitedApproval() {
  return (
    <AttackPage
      title={TITLE}
      description={DESCRIPTION}
      hegotaScenario={unlimitedApprovalScenario}
    />
  );
}
