# Hegotá bills Amsterdam-rate state gas but still enforces the pre-Amsterdam EIP-7825 cap — deploying anything over ~24576×200 gas' worth of code is impossible

## Symptom

Deploying a real, unmodified contract near the EIP-170 size limit (tested with the
`@safe-global/safe-contracts` `Safe.sol` singleton, ~23.6KB runtime bytecode) fails on Hegotá.
Any transaction with `gas_limit > 16,777,216` is rejected outright at submission:
```
eth_sendRawTransaction → "Transaction gas limit exceeds maximum. ... transaction gas limit: 40000000"
```
Via `eth_call` (bypasses admission, so it can't reject on gas_limit) we confirmed the deployment
itself genuinely needs ~36.75M gas to execute — over 2x the enforced ceiling, so there's no
`gasLimit` value that both gets admitted and succeeds. A much smaller, already-deployed contract
(`MinimalERC7579AccountFactory`, 3.8KB initcode) also costs ~6x-8x more gas to deploy on Hegotá
than the same bytecode would on a standard EVM — this isn't Safe-specific.

## Root cause

Two different "is Amsterdam active" checks in the codebase disagree about Hegotá:

- **VM execution** (`crates/vm/levm/src/execution_handlers.rs`, `crates/vm/levm/src/vm.rs`)
  gates the EIP-8037 state-gas repricing (code deposit: 1530 gas/byte vs. the old 200 gas/byte)
  and its compensating "state gas reservoir" (lets `gas_limit` exceed 16,777,216 by funding a
  separate pool earmarked for state costs) on `fork >= Fork::Amsterdam` — an **ordinal** enum
  comparison. Since `Fork::Hegota = 26` is declared after `Fork::Amsterdam = 25`
  (`crates/common/types/genesis.rs`), this is true for Hegotá.
- **Mempool admission** (`crates/blockchain/blockchain.rs:3252`) gates the old flat EIP-7825
  cap's exemption on `config.is_amsterdam_activated(header.timestamp)` — a **timestamp** check
  reading a dedicated `amsterdam_time` genesis field. Hegotá's devnet genesis only sets
  `hegota_time`/`heze_fork_epoch`, never `amsterdam_time`, so this returns **false**.

Net effect: Hegotá inherits Amsterdam's pricier state-gas cost (via the ordinal check) but not
its compensating reservoir mechanism, because the timestamp-gated admission check still runs the
pre-Amsterdam branch and rejects any `gas_limit > 16,777,216` before a transaction ever reaches
the VM logic that would otherwise let it fund state costs from the excess. This blocks any
contract deployment above roughly 10–11KB (where the EIP-8037 code-deposit charge alone already
exceeds 16,777,216), well under half of the standard 24576-byte EIP-170 limit.

## Suggested fix

Either set `amsterdam_time` in Hegotá's genesis config (e.g. same value as `hegota_time`), or
change the `blockchain.rs:3252` admission check to use the same ordinal `fork >= Fork::Amsterdam`
comparison the VM already uses internally, so it doesn't disagree with itself about whether
Amsterdam is active.
