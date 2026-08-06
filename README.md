# Can you trust what your wallet shows you?

**[Try the live demo → eip7906.forshtat.com](https://eip7906.forshtat.com/)**

In February 2025, a compromised signing UI showed Bybit's operators a routine transaction —
while the transaction itself silently hijacked their multisig's control plane and drained
**$1.5B**. The wallet's "clear signing" screen only shows what it *decoded*. It can be wrong,
spoofed, or simply outdated by the time your transaction lands on-chain.

This is an interactive demo of **[EIP-7906](https://eips.ethereum.org/EIPS/eip-7906)**, a
proposed Ethereum primitive that closes that gap: it lets a transaction inspect its own real
on-chain trace *after* it executes — and cancel itself if what actually happened doesn't match
what was promised, no matter what any wallet displayed when you signed.

No install, no MetaMask, no real funds needed — just open the link above.

## What you'll do

The demo runs six real attack patterns against a live Ethereum-compatible devnet, through a
simulated hardware wallet in your browser. For each one, you'll:

1. See what a compromised wallet's "clear signing" screen would show you — a plausible,
   reassuring description of the transaction.
2. Approve and submit it anyway, exactly as an unsuspecting user would.
3. Watch the transaction get caught: EIP-7906's post-execution check reverts it before it can
   take effect, because what actually happened on-chain doesn't match the check's conditions.
4. Toggle a "compliant" version of the same transaction and watch it succeed normally.

A guided tour (the bar at the top of the page) walks you through everything in order, starting
with a plain-language explanation of the attack and the primitive before any transactions happen.

### The six attacks

| Attack | What it does |
|---|---|
| **Safe control-plane takeover** | The Bybit hack itself, modeled to scale — a disguised transaction hijacks a Gnosis Safe's threshold and guard settings. |
| **Unlimited token approval** | A dApp requests `approve(spender, type(uint256).max)` instead of the amount it showed you. |
| **Hidden ETH drain in multicall** | A multicall secretly sends ETH to a second, undisclosed address alongside the real recipient. |
| **MEV sandwich** | A bot front-runs your swap, moving the price between your quote and your transaction. |
| **Oracle manipulation** | A price oracle goes stale or gets manipulated mid-transaction. |
| **Proxy implementation swap** | A proxy contract's implementation is swapped to something malicious after you approved an upgrade. |

### Bonus: Private Swap

A separate, deeper example built on a real zero-knowledge shielded pool: deposit ETH under a
secret note, then withdraw and swap it under a different identity — with EIP-7906 asserting
after the fact that the swap paid out at least the promised minimum, with no leftover funds
stranded anywhere.

## No wallet, no funds, no problem

The live demo works out of the box with a built-in demo wallet — no browser extension, no
seed phrase, no real money. A **Faucet** button in the sidebar tops it up with devnet ETH
(worthless test currency) whenever you need more. If you'd rather use your own wallet
(MetaMask, WalletConnect, etc.), that works too — connect it from the same button.

Everything runs on **Hegotá**, a public Ethereum-compatible devnet that implements EIP-7906
alongside the related [EIP-8141](https://eips.ethereum.org/EIPS/eip-8141) (frame transactions)
and [EIP-8272](https://eips.ethereum.org/EIPS/eip-8272) (recent-root references) it builds on.
Transactions are real, on-chain, and viewable on the
[Dora block explorer](https://dora.hegota.ethrex.xyz) — just with no real value at stake.

## Want to know more, or run it yourself?

- The demo's own **EIP-7906 Explained** and **Architecture** pages cover the mechanism in
  more depth than this README does, with the same live examples to point at.
- To build, test, or contribute to this project locally, see
  **[CONTRIBUTING.md](./CONTRIBUTING.md)**.
