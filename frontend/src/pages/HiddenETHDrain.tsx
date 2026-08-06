import AttackPage from "../components/AttackPage.js";
import { hiddenEthDrainScenario } from "../hegotaScenarios/hiddenEthDrainScenario.js";

const TITLE = "Hidden ETH drain in multicall";
const DESCRIPTION = "A wallet UI shows a single ETH transfer to a legitimate address. A hidden multicall leg simultaneously sends ETH to an attacker. Each framework's policy contract scans TXTRACE balance increases and reverts if any address other than the declared recipient gained ETH.";

export default function HiddenETHDrain() {
  return (
    <AttackPage
      title={TITLE}
      description={DESCRIPTION}
      hegotaScenario={hiddenEthDrainScenario}
    />
  );
}
