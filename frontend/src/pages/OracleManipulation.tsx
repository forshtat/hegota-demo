import AttackPage from "../components/AttackPage.js";
import { oracleManipulationScenario } from "../hegotaScenarios/minOutputScenarios.js";

const TITLE = "Oracle manipulation";
const DESCRIPTION = "A price oracle is manipulated between the time a transaction is simulated off-chain (good price → user signs) and the time it is mined (bad price → user overpays or receives far less). Each framework's policy contract reads the actual Transfer event amount via TXTRACE and reverts if it falls below the minimum the user signed.";

export default function OracleManipulation() {
  return (
    <AttackPage
      title={TITLE}
      description={DESCRIPTION}
      hegotaScenario={oracleManipulationScenario}
    />
  );
}
