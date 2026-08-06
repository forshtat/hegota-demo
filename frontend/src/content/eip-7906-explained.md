# EIP-7906 — Transaction Assertions

Three new EVM opcodes that expose a transaction's full side-effect trace to smart contracts —
enabling on-chain policy enforcement that was previously impossible. Built on top of
**EIP-8141**: all three opcodes are only valid inside a `POST_TX` frame.

## The three opcodes

### TXTRACE (0xB6)

Given a *parameter ID* and an *index*, returns one value from the current transaction's
execution trace. The full trace is exposed across four categories:

- **ETH balance changes** — how many addresses changed balance, which address, and the exact before/after amounts
- **Storage writes** — how many slots were written, which contract and slot, and the before/after values
- **Contract deployments** — how many contracts were deployed and their addresses
- **Events emitted** — how many events, which contract emitted each, all four topics, and the raw data length

### TXDIFF

Provides direct, keyed access to a single entry in the state diff — complementing `TXTRACE`'s
enumeration model. Accepts a *param*, an *address*, and optionally a *slot key*, and returns the
corresponding before or after value:

- **Storage slot before/after** — the value of a specific (address, slot) before and after the transaction
- **Balance before/after** — the ETH balance of a specific address before and after the transaction
- **Code hash before/after** — the codehash of a specific address before and after the transaction (undeployed = empty-code hash)

If the queried address or slot was never modified during the transaction, `TXDIFF` returns the
current live value for both the before and after variants.

### EVENTDATACOPY (0xB7)

Copies raw event data bytes from a specific event in the trace into memory. Necessary for
reading ABI-encoded payloads — for example, the `amount` field in an ERC-20
`Approval(owner, spender, amount)` event.

## The `POST_TX` frame mode (EIP-8141)

EIP-7906 is built on top of **EIP-8141** and adds a new frame mode value, `POST_TX` (= 3),
alongside the `DEFAULT`, `VERIFY`, and `SENDER` modes already defined there. `TXTRACE`, `TXDIFF`,
and `EVENTDATACOPY` can only execute inside a `POST_TX` frame — calling any of them in a legacy
transaction, an EIP-1559 transaction, or any other EIP-8141 frame mode results in an exceptional
halt.

**Trailing suffix of frames** — `POST_TX` frames must form a contiguous trailing suffix of the
transaction's frame list. Once any frame has mode `POST_TX`, every subsequent frame must also be
`POST_TX`.

**Static-call semantics** — A `POST_TX` frame executes as a `STATICCALL` — no state writes, no
ETH transfers. The trace it reads is the final, settled outcome of everything that ran before it.

**Unconditional revert on failure** — If a `POST_TX` frame reverts, the entire transaction
execution body is reverted — including any gas payment already approved by an earlier frame.
This override applies even inside atomic batches.

**Composable independent assertions** — Multiple `POST_TX` frames can coexist. Each assertion
module runs its own check in its own frame and can independently invalidate the transaction,
without needing to coordinate with other assertion providers.

## Key properties

**Read-only view of the current transaction** — TXTRACE reads from the same transaction's trace
— there is no cross-transaction access. A guard or hook that calls TXTRACE sees exactly what
happened in that execution, nothing more.

**No way to fake the trace** — The trace is computed by the EVM, not passed as calldata. A
malicious caller cannot forge balance changes, storage writes, or events — they are recorded by
the EVM regardless of what the caller claims.

**Reentrancy safe** — The opcodes are read-only and scoped to the current transaction. They do
not alter state, transfer value, or call external contracts.

**Enumeration and direct lookup** — TXTRACE exposes the full ordered state diff by index —
necessary for negative conditions ("only these changes happened"). TXDIFF complements it with
O(1) keyed access for targeted checks, avoiding a linear search when only one specific slot or
balance matters.

## Why on-chain state access changes everything

The Ethereum transaction model has always had a fundamental asymmetry: the EVM knows exactly
what a transaction did — every balance moved, every slot written, every event emitted — but that
knowledge evaporates the moment execution ends. Contracts could only react to their own internal
state, not to the global reality of what just happened. Off-chain tools (block explorers,
simulation APIs, monitoring bots) could observe the trace after the fact, but by then it was too
late to prevent harm.

TXTRACE closes that gap. For the first time, a smart contract can read the authoritative
execution trace — not a simulation, not a claim made in calldata, not a promise from the caller —
and act on it within the same atomic transaction. The assertion runs in a `POST_TX` frame, which
executes after the entire transaction body has settled. If the assertion fails, the entire
transaction reverts unconditionally. There is no window between "this is what happened" and
"this is what the policy says should have happened."

This enables a new class of on-chain guarantee that previously required trusting off-chain
infrastructure: simulation results, monitoring services, audit reports, and manual review. All of
those remain useful, but none of them are binding. A TXTRACE assertion is binding — it is
enforced by the EVM itself.

### Three distinct usage patterns

#### 1 — Protocol-level invariants (function modifiers) — *DeFi protocols*

An assertion contract is deployed on-chain and wired into a DeFi protocol as a post-execution
modifier — the protocol equivalent of a Solidity `require()`, but for global transaction outcomes
rather than local state. Before the body of a sensitive function executes, the modifier snapshots
relevant state (total supply, reserve balances, key storage slots). After execution, it calls the
assertion contract which reads the TXTRACE diff and verifies that the snapshot invariants hold.

Because the assertion is a deployed, immutable contract, it is not controlled by any admin key,
cannot be paused mid-transaction, and applies identically to every call — including calls from
flash-loan contracts, cross-protocol composability, and upgrade paths the original developers did
not anticipate. The protocol becomes self-auditing in a meaningful sense: the invariants are not
written in a specification document or a test suite, they are enforced in the transaction itself.

This is particularly powerful against reentrancy and flash-loan attacks that exploit the gap
between a contract's stated invariants and the actual state mid-execution. A TXTRACE assertion
sees the final net effect of the entire call tree — it cannot be fooled by intermediate state
that is "restored" before the outer call returns.

#### 2 — Wallet-generated assertions (simulation → enforcement) — *Smart accounts*

A smart account wallet simulates the user's transaction using the standard
`eth_simulateTransaction` API and observes what should happen: which addresses receive tokens,
how much ETH moves, which contracts get called. It then automatically constructs an assertion
that encodes exactly those expected outcomes — "this transaction should transfer exactly 100 USDC
to address 0xABCD and nothing else should change" — and attaches it to the transaction as a
post-execution hook.

The user signs once. If the real execution matches the simulation, the assertion passes silently.
If the execution deviates — because of MEV, front-running, oracle manipulation, a compromised RPC
node that served a falsified simulation, or a malicious dApp UI — the assertion fails and the
entire transaction reverts before any funds leave the account.

This pattern closes the most dangerous gap in the current user-facing Ethereum experience: the
fact that simulation is advisory but execution is binding. Users currently have no choice but to
trust that what they saw in the wallet preview is what will actually happen. With TXTRACE
assertions generated by the wallet, that trust becomes a verifiable, enforceable commitment — the
preview *is* the contract.

#### 3 — dApp-supplied assertion scripts (intent UX) — *Any contract, any protocol*

A dApp includes an assertion contract address alongside the transaction it asks the user to sign.
The assertion contract encodes the dApp's commitment about what the transaction is supposed to
accomplish — expressed as verifiable outcome conditions rather than as calldata the user cannot
read. The user's smart account runs the assertion as a post-execution hook; if it passes, the
transaction confirms; if not, it reverts.

This is a fundamentally different interaction model. Today, a dApp asks the user to approve a
specific sequence of calls — *how* an outcome is achieved. With assertion scripts, a dApp
declares *what* outcome the user should receive and puts that declaration on-chain as an
enforceable commitment. The dApp cannot silently change the terms between signing and execution:
the assertion is fixed at signing time and is evaluated against the actual execution result.

Because the assertion reads from TXTRACE — not from the called contract's own interface — it
works for any protocol, including contracts that predate EIP-7906 by years and have no awareness
of it. A single assertion pattern can protect a user interacting with Uniswap, Aave, a new DEX, or
a custom one-off contract, without any of those protocols implementing anything. This makes
TXTRACE the first credible foundation for a permissionless, generic, any-contract Intent UX layer
on Ethereum.
