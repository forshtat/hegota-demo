# Can you trust what your wallet shows you?

This demo walks through six real attack patterns — including the kind of disguised transaction
that hit Bybit for $1.5B in February 2025 — and a new Ethereum primitive, EIP-7906, that lets a
transaction check what actually happened on-chain and cancel itself if something doesn't match,
regardless of what any wallet UI displayed.

> **The core idea:** a wallet's "clear signing" screen only tells you what it decoded — it can be
> wrong, spoofed, or simply outdated by the time your transaction lands. EIP-7906 adds a second,
> independent check that runs after the transaction executes, using the transaction's own real
> on-chain trace. If that check fails, the transaction reverts — its effects are rolled back and
> it never takes effect, no matter what you were shown when you signed.
>
> You'll set up a real account once, then try each attack yourself: see what a compromised wallet
> UI would show you, then watch the on-chain assertion catch the attack anyway.
