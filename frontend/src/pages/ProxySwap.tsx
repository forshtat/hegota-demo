import AttackPage from "../components/AttackPage.js";
import { proxySwapScenario } from "../hegotaScenarios/proxySwapScenario.js";

const TITLE = "Proxy implementation swap";
const DESCRIPTION = "An attacker convinces a multisig to approve a transaction that replaces the proxy's implementation address (EIP-1967 slot) with a malicious contract. The change is invisible in standard tx simulation. Each framework's policy contract watches the EIP-1967 slot via TXTRACE and reverts any write to it.";

export default function ProxySwap() {
  return (
    <AttackPage
      title={TITLE}
      description={DESCRIPTION}
      hegotaScenario={proxySwapScenario}
    />
  );
}
