export interface TourStop {
  path: string;
  label: string;
  caption: string;
  requiresAction?: boolean;
}

export const tourStops: TourStop[] = [
  {
    path: "/",
    label: "Welcome",
    caption: "Start here: what this demo shows, and why it matters.",
  },
  {
    path: "/eip-7906-explained",
    label: "EIP-7906 Explained",
    caption:
      "What EIP-7906's TXTRACE/EVENTDATACOPY opcodes actually let a transaction check about itself.",
  },
  {
    path: "/clear-signing",
    label: "Architecture",
    caption:
      "Why simulation alone isn't enough — and where EIP-8141's POST_TX frame closes the gap.",
  },
  {
    path: "/legacy-frameworks",
    label: "Existing Frameworks",
    caption:
      "How this used to be mitigated — MetaMask Enforcers, Gnosis Safe Guards, ERC-6900/7579 Hooks — before EIP-8141.",
  },
  {
    path: "/demo",
    label: "Demo Overview",
    caption: "A map of every live scenario you're about to run.",
  },
  {
    path: "/account-setup",
    label: "Set Up Your Account",
    caption:
      "One-time setup: provision the two accounts (ERC-7579 smart account + Safe) this demo runs on.",
    requiresAction: true,
  },
  {
    path: "/control-plane-takeover",
    label: "Control-Plane Takeover",
    caption:
      "A disguised transaction hijacks a Safe's control plane — this is what really happened to Bybit in Feb 2025.",
    requiresAction: true,
  },
  {
    path: "/mev-sandwich",
    label: "MEV Sandwich",
    caption:
      "An MEV bot moves the price between your quote and your transaction — see the commitment catch it.",
    requiresAction: true,
  },
  {
    path: "/oracle-manipulation",
    label: "Oracle Manipulation",
    caption: "Same underlying flaw, different framing: a price oracle goes stale mid-transaction.",
    requiresAction: true,
  },
  {
    path: "/unlimited-approval",
    label: "Unlimited Approval",
    caption:
      "A dApp asks for more spending approval than it showed you — capped and caught on-chain.",
    requiresAction: true,
  },
  {
    path: "/hidden-eth-drain",
    label: "Hidden ETH Drain",
    caption:
      "A multicall quietly sends ETH to a second, undisclosed address alongside the real recipient.",
    requiresAction: true,
  },
  {
    path: "/proxy-swap",
    label: "Proxy Impl Swap",
    caption:
      "A proxy's implementation gets swapped to something malicious — invisible to calldata inspection.",
    requiresAction: true,
  },
];
