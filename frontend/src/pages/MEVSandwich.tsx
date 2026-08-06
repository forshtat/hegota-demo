import AttackPage from "../components/AttackPage.js";
import { mevSandwichScenario } from "../hegotaScenarios/minOutputScenarios.js";

const TITLE = "MEV sandwich attack";
const DESCRIPTION = "An MEV bot front-runs a swap to move the price, executes the victim's trade at a worse rate, then back-runs to pocket the difference. Each framework's policy contract reads the actual Transfer event amount via TXTRACE and reverts if it falls below the signed minimum.";

export default function MEVSandwich() {
  return (
    <AttackPage
      title={TITLE}
      description={DESCRIPTION}
      hegotaScenario={mevSandwichScenario}
    />
  );
}
