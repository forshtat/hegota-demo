# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Hardhat v3 TypeScript integration test suite validating EIP-7906 opcodes (`TXTRACE` 0xB6, `EVENTDATACOPY` 0xB7) through four Ethereum security frameworks. Tests must run against an **EthRex node** (the reference EVM at `../ethrex`) with EIP-7906 + EIP-8141 enabled — they do not work against Hardhat's built-in EVM, which does not know these opcodes.

There is also a `contracts/hegota/` scenario demonstrating EIP-7906's `POST_TX`-frame model (see the "Hegotá devnet" section below) — unlike every other contract in this repo, it calls `TXTRACE`/`EVENTDATACOPY` from inside a `POST_TX` frame of an EIP-8141 type-`0x06` frame transaction, not mid-call from an ordinary transaction.

The repo also contains a React/Vite demo frontend (`frontend/`) that drives the same attack scenarios interactively through a browser.

## Commands

```bash
# Compile contracts (works without a node)
npx hardhat build

# Run all tests against EthRex
npx hardhat test --network ethrex

# Run a single file
npx hardhat test --network ethrex test/metamask-enforcers/SpendingLimitEnforcer.test.ts

# Or via npm scripts
npm run test:metamask   # test/metamask-enforcers/*.test.ts
npm run test:safe       # test/gnosis-safe/*.test.ts
npm run test:erc6900    # test/erc6900/*.test.ts
npm run test:erc7579    # test/erc7579/*.test.ts

# Deploy all contracts and write frontend/.env
npm run deploy
# Then start the frontend
npm run dev
```

Install dependencies (the `legacy-peer-deps` flag is needed because `@safe-global/safe-contracts` declares a peer dep on ethers v5 — only its JS side is affected, not the Solidity source we use):
```bash
npm install   # .npmrc sets legacy-peer-deps=true automatically
```

Configure the EthRex node in `.env` (copy from `.env.example`):
```
ETHREX_RPC_URL=http://localhost:8545
ETHREX_CHAIN_ID=1337
ETHREX_PRIVATE_KEY=0x...
```

`npm run deploy` reads the root `.env`, deploys oracle contracts **and all scenario contracts** (~60 contracts across 6 scenarios), then writes `frontend/.env` with all `VITE_*` address keys. `frontend/.env.example` shows the expected shape. Run `npx hardhat build` first if artifacts are missing. After deploying, start the frontend with `npm run dev`.

The frontend connects via an injected web3 provider (MetaMask / AppKit). Set `VITE_WALLETCONNECT_PROJECT_ID` in `frontend/.env` for multi-wallet support (free project ID at cloud.walletconnect.com). Users sign only the attack and mitigation transactions — setup is instant (loads pre-deployed addresses from env).

## Production interface dependencies

Guards and enforcers inherit from real, production-deployed interface contracts — not local stubs.

| Framework                      | Source                                                                   | What we use                                                                                          |
|--------------------------------|--------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| Gnosis Safe                    | `@safe-global/safe-contracts` (npm)                                      | `Guard`, `BaseGuard` from `contracts/base/GuardManager.sol`; `Enum` from `contracts/common/Enum.sol` |
| MetaMask Delegation (ERC-7710) | `lib/delegation-framework` (git submodule)                               | `ICaveatEnforcer` from `src/interfaces/ICaveatEnforcer.sol`                                          |
| ERC-7579 / ModeCode type       | `lib/delegation-framework/lib/erc7579-implementation` (nested submodule) | `ModeCode` from `src/lib/ModeLib.sol`                                                                |

**Gnosis Safe Guards** extend `BaseGuard` (which provides the `supportsInterface` required by `Safe.setGuard`). `checkTransaction` has 11 parameters — the 6 gas/signature params (`safeTxGas`, `baseGas`, `gasPrice`, `gasToken`, `refundReceiver`, `signatures`) are unused in our policy logic but must be present in the signature.

**MetaMask enforcers** implement `ICaveatEnforcer` imported directly from `@metamask/delegation-framework/interfaces/ICaveatEnforcer.sol`. All four hooks (`beforeAllHook`, `beforeHook`, `afterHook`, `afterAllHook`) must be implemented; unused hooks are left as no-ops. `ModeCode` is `bytes32` under the hood.

### Submodule setup

`MetaMask/delegation-framework` is Forge-only (no npm package). It is included as a git submodule at `lib/delegation-framework` (pinned to v1.3.0). Two of its nested submodules must also be initialized:

```bash
git submodule update --init lib/delegation-framework
git -C lib/delegation-framework submodule update --init --depth 1 lib/account-abstraction lib/erc7579-implementation
```

`@nomicfoundation/hardhat-foundry` (plugin in `hardhat.config.ts`) makes Hardhat read `remappings.txt`. The project root `remappings.txt` maps all `@erc7579/` and `@account-abstraction/` imports to the **same** nested submodule copies that delegation-framework itself uses — this is critical to avoid `ModeCode` type-identity conflicts (two files declaring the same type are incompatible in Solidity).

```
@metamask/delegation-framework/=lib/delegation-framework/src/
@erc7579/=lib/delegation-framework/lib/erc7579-implementation/src/
@account-abstraction/=lib/delegation-framework/lib/account-abstraction/contracts/
```

Because `ICaveatEnforcer.sol` uses `pragma solidity 0.8.23` (fixed), all enforcer contracts and `TxTraceLib.sol` use `pragma solidity ^0.8.23`. This causes them to compile under the `0.8.23` compiler entry in `hardhat.config.ts`. All other contracts compile under `0.8.28`.

`soispoke/minimal-shielded-pool` (a real BN254/Groth16 join-split shielded pool, used by the
Hegotá private-swap demo below) is also a git submodule, at `lib/minimal-shielded-pool`:

```bash
git submodule update --init lib/minimal-shielded-pool
```

Unlike `delegation-framework`, this submodule's own contracts are not imported directly by our
Solidity. Our fork of its settlement contract (`ShieldedPoolLogic.sol`) and Yul dispatcher
(`ShieldedPoolDispatcher.yul`) live under `contracts/hegota/shielded-pool/`, not as a patch applied
to the submodule in place — alongside byte-identical vendored copies of `PoseidonBN254.sol`,
`Groth16Verifier.sol`, `PoseidonT3.sol`, and `PoseidonT4.sol`. Those four are copied rather than
imported from the submodule path because solc's via-IR optimizer produces measurably larger
(~4KB) runtime bytecode for `ShieldedPoolLogic.sol` when those imports resolve outside its own
directory — enough to push the deploy past Hegotá's gas cap. See `pool-issues.md` for the full
story of what was changed and why.

## The oracle pattern (critical architectural constraint)

Solidity's `verbatim` builtin — the standard escape hatch for unknown opcodes — is **only available in pure Yul, not in Solidity inline assembly**. Because of this, 0xB6 and 0xB7 cannot be emitted directly from Solidity code.

The workaround: two minimal "oracle" contracts whose bytecode is hand-assembled as `bytes` constants in `TxTraceLib.sol` and deployed via `TxTraceLib.deployOracles()` — a Solidity function that uses the `create` opcode in inline assembly. Every policy contract calls `TxTraceLib.deployOracles()` in its constructor and stores the returned addresses as `public immutable`s.

**TxTraceQueryOracle** — `staticcall(abi.encode(uint256 param, uint256 index))` → returns `abi.encode(uint256 result)`

**EventDataOracle** — `staticcall(abi.encode(uint256 eventIndex, uint256 dataOffset, uint256 length))` → returns `length` raw bytes (no ABI wrapper)

`TxTraceLib.sol` wraps these two calls as `query(oracle, param, index)` and `getEventData(oracle, eventIndex, offset, length)`. All policy contracts import `TxTraceLib` and store both oracle addresses as `public immutable`s (`txTraceOracle`, `eventDataOracle`).

The initcodes live only in `TxTraceLib.sol` as `TXTRACE_INITCODE` and `EVENTDATA_INITCODE` private constants. If you change the oracle logic, update only that one place.

## How tests are structured

Each test file:
1. Deploys the policy contract (which deploys its own oracle pair internally) and its mock framework account in `async function deploy()`.
2. Runs two tests per policy: a **pass** case (constraint satisfied → no revert) and a **reject** case (constraint violated → `revertedWithCustomError`).

The `TestSubject` contract (`contracts/shared/TestSubject.sol`) is the action contract in every scenario — it has `emitTransfer`, `writeSlot`, `deployContract`, `sendEth`, `sendEthToTwo`, and `transferERC20` entry points that the mock framework accounts call on behalf of the test.

**Mock account calldata encoding**: `MockERC7579Account` and `MockModularAccount` strip the hook prefix before forwarding calldata to the target contract (`callData[hookData.length:]`). The hookPrefix is `abi.encode(hookParams...)` prepended to the subject calldata; its length equals the `hookData` returned by the hook's pre-check.

## Policy contracts and what they validate

### Phase 1 — Basic validation

| Contract                | Framework   | Hook                                            | TXTRACE params used                                             |
|-------------------------|-------------|-------------------------------------------------|-----------------------------------------------------------------|
| `SpendingLimitEnforcer` | MetaMask    | `ICaveatEnforcer.afterHook`                     | `BALANCE_COUNT`, `BALANCE_ADDRESS`, `BALANCE_BEFORE/AFTER`      |
| `SlotProtectionGuard`   | Gnosis Safe | `ITransactionGuard.checkAfterExecution`         | `STORAGE_COUNT`, `STORAGE_ADDRESS`, `STORAGE_SLOT`              |
| `NoDeployGuard`         | Gnosis Safe | `ITransactionGuard.checkAfterExecution`         | `CONTRACT_COUNT`, `CONTRACT_ADDR`                               |
| `RequiredEventHook`     | ERC-6900    | `IERC6900ExecutionHookModule.postExecutionHook` | `EVENT_COUNT`, `EVENT_TOPIC0`, `EVENT_DATA_LEN` + EVENTDATACOPY |
| `TxTraceValidator`      | ERC-7579    | `IERC7579Hook.postCheck`                        | same as RequiredEventHook (inherits it)                         |

### Phase 2 — Threat counter-measures

Each threat has parallel implementations across frameworks (Enforcer / Guard / Hook):

| Threat                          | MetaMask Enforcer             | Gnosis Safe Guard          | ERC-6900 Hook             | ERC-7579 Hook             |
|---------------------------------|-------------------------------|----------------------------|---------------------------|---------------------------|
| Unlimited token approval        | `NoUnlimitedApprovalEnforcer` | `NoUnlimitedApprovalGuard` | `NoUnlimitedApprovalHook` | `NoUnlimitedApprovalHook` |
| Multisig control-plane takeover | —                             | `SafeIntegrityGuard`       | —                         | —                         |
| Proxy implementation swap       | —                             | `ProxyIntegrityGuard`      | —                         | —                         |
| MEV sandwich / oracle TOCTOU    | `MinOutputEnforcer`           | `MinOutputGuard`           | `MinOutputHook`           | `MinOutputHook`           |
| Hidden ETH drain in multicall   | `ExactBeneficiaryEnforcer`    | `ExactBeneficiaryGuard`    | `ExactBeneficiaryHook`    | `ExactBeneficiaryHook`    |
| Slot write protection           | `SlotProtectionEnforcer`      | `SlotProtectionGuard`      | `SlotProtectionHook`      | `SlotProtectionHook`      |

## Hegotá devnet — POST_TX assertion demo

Ethrex's public "Hegotá" devnet (chain id `3151908`, RPC `https://rpc1.hegota.ethrex.xyz`, faucet `https://faucet.hegota.ethrex.xyz`, explorer `https://dora.hegota.ethrex.xyz`) integrates EIP-8141 (frame transactions, type `0x06`), EIP-8250 (keyed nonces), EIP-8272 (recent roots), and EIP-7906 together. There, `TXTRACE`/`EVENTDATACOPY`/`TXDIFF` are hard-gated to only execute inside a `POST_TX` frame (mode 3) of a frame transaction — calling them mid-call from an ordinary transaction (the pattern every other contract in this repo uses) exceptional-halts.

- `contracts/hegota/RequiredEventAssertion.sol` — a standalone contract meant to be called directly as a `POST_TX` frame's target (not via a hook/guard/enforcer interface). It reuses `RequiredEventHook`'s event-matching logic against `TxTraceLib`.
- `frontend/src/frametx.ts` — TypeScript port of Ethrex's reference frame-tx RLP encoder (`origin/hegota-devnet:scripts/hegota-devnet/frametx.py`); validated against that script's golden vector via `scripts/verify-frametx-encoding.mjs`.
- `frontend/src/hegotaWallet.ts` — builds and signs the 3-frame demo transaction (`VERIFY` self-verify → `DEFAULT` action → `POST_TX` assertion) with a dedicated relay/demo key (see the security note in `frontend/.env.example`) — MetaMask has no standard way to produce the raw-digest signature EIP-8141's `VERIFY` frame requires. Every other interaction (nonce/fee reads, receipt polling, and the final `eth_sendRawTransaction`) is routed through the caller-supplied MetaMask-connected `BrowserProvider` from `useWallet()`, not a standalone RPC client.
- Frontend page: `/post-tx-assertion` (`frontend/src/pages/PostTxAssertionDemo.tsx`). It drives network switching (`wallet_addEthereumChain`/`switchNetwork`, via `WalletContext.tsx`'s `addHegotaNetwork()`/`switchToHegota()`) and an EIP-712 "confirm" step (`frontend/src/contracts/postTxAction.ts`) through the connected wallet. Every other demo page detects a connected Hegotá wallet and explains why it can't run there (`ThreatPage.tsx`'s `isHegota` branch) instead of attempting the ordinary-transaction flow.

### Phase C — a real ERC-7579 account owned by the connected wallet

The DEFAULT frame can instead target `PostTxExecutor.executeAction(...)`, which checks an EIP-712 signature (the same struct from `postTxAction.ts`, now load-bearing) against a minimal ERC-7579 smart account before forwarding the call — so the demo action is genuinely authorized by whichever key the account's installed validator trusts, not merely decorative.

- `contracts/erc7579/MinimalERC7579Account.sol` — a self-contained account implementing the real `IERC7579Account` interface (`isValidSignature` delegates to an installed validator; `executeFromExecutor` is gated to installed executors) but with its own lightweight storage instead of Rhinestone's `ModuleManager`/`SentinelList`/`HookManager` stack. Its validator and executor are installed once, in the constructor — there is no runtime `installModule` support.
- `contracts/erc7579/OwnerEcdsaValidator.sol` — a minimal validator module (type 1): one stored secp256k1 owner per installing account, checked via `ECDSA.recover`.
- `contracts/erc7579/PostTxExecutor.sol` — a minimal executor module (type 2) and the frame tx's actual DEFAULT-frame target. Computes the EIP-712 digest on-chain (`nextActionHash`, so the frontend never has to reproduce the domain separator itself) and calls `executeFromExecutor` once the signature checks out.
- `contracts/erc7579/MinimalERC7579AccountFactory.sol` — permissionless CREATE2 factory; deployment is sponsored by the relay key on behalf of any owner address, who never needs Hegotá ETH or a signature for that one-time step. The account address is deterministic per owner.
- `contracts/erc7579/IMinimalValidatorExecutor.sol` — a minimal subset of ERC-7579's `IERC7579Module`/`IValidator`/`IExecutor` interfaces, deliberately omitting `validateUserOp`: the real `IERC7579Module.sol` (vendored under `lib/delegation-framework/lib/erc7579-implementation`) pulls in `PackedUserOperation` via a bare `"account-abstraction/..."` import that collides with an unrelated npm copy of the same package already in this repo's `node_modules` (the `erc7579-implementation` devDependency), producing a genuine Solidity type-identity clash. This demo never involves an ERC-4337 EntryPoint, so `validateUserOp` isn't needed.
- `frontend/src/erc7579Account.ts` — predicts/checks/provisions the account and encodes `executeAction` calldata for the frontend.

```bash
# Deploy TestSubject + RequiredEventAssertion + the Phase C contracts to Hegotá, and
# write VITE_HEGOTA_* into frontend/.env
npm run deploy:hegota

# Validate the frame-tx encoder against Ethrex's own golden vector
node scripts/verify-frametx-encoding.mjs

# Live checks for the Phase C smart-account flow (direct call, then a full frame tx)
node scripts/verify-erc7579-account.mjs
node --experimental-strip-types scripts/verify-erc7579-frametx.mjs
```

### Control-Plane Takeover on Hegotá — a temporary Safe stand-in

`frontend/src/hegotaSafeAccount.ts` provisions a real, per-user 1-of-1 Gnosis Safe via the real
`@safe-global/safe-contracts` `SafeProxyFactory` + `SafeProxy`. Deploying the real, unmodified
Safe singleton (`Safe.sol`, ~23.6KB) to Hegotá is currently blocked by an upstream ethrex
gas-accounting bug (see `HEGOTA_GAS_CAP_REPORT.md`): Hegotá inherits Amsterdam's EIP-8037
per-byte state-gas repricing for code deposits but not its compensating tx-admission gas-limit
exemption, so any deployment needing more than ~16.7M gas — the real Safe singleton needs
~36.75M — is rejected outright.

`contracts/hegota/MinimalSafeStub.sol` is a temporary, much smaller singleton standing in for
`Safe.sol` until that bug is fixed. It's deployed behind the exact same real, unmodified
`SafeProxyFactory` + `SafeProxy` (both small enough to deploy on Hegotá today), replicating only
what `SafeControlPlaneAssertion.sol` and `safeExec.ts` actually touch: `threshold` at
storage slot 4, the guard address at `GuardManager`'s exact hashed slot, and the real Safe's
`SafeTx` EIP-712 typehash/domain — so `hegotaSafeAccount.ts` and `safeExec.ts` needed **zero**
code changes, and swapping the real Safe singleton back in later is purely a
`VITE_HEGOTA_SAFE_SINGLETON` address change in `frontend/.env`.

```bash
# Deploy MinimalSafeStub + the real SafeProxyFactory to Hegotá, and write
# VITE_HEGOTA_SAFE_SINGLETON / VITE_HEGOTA_SAFE_PROXY_FACTORY into frontend/.env
node scripts/deploy-hegota-safe-stub.mjs

# Live checks: provision a stub Safe, confirm getOwners()/getThreshold() and the threshold/guard
# storage slots, and confirm genuine CALL vs DELEGATECALL dispatch (the load-bearing behavior
# the Control-Plane Takeover demo depends on) by checking which contract's storage actually changed
node scripts/verify-hegota-safe-stub.mjs
```

## Frontend demo app

`frontend/` is a Vite + React 19 + MUI 7 + ethers v6 single-page app. It connects to EthRex (and Hegotá) through an injected wallet (MetaMask, via Reown AppKit, or the built-in demo wallet stub — `frontend/src/devAutoWallet.ts` — for visitors with no wallet extension) — see `frontend/src/wallet.ts` and `frontend/src/contexts/WalletContext.tsx`. The Hegotá POST_TX Assertion demo (below) routes network switching, reads, and transaction submission through the connected wallet like everything else, but the frame transaction's outer EIP-8141 signature is still produced by a dedicated relay key, since MetaMask cannot sign the raw digest that requires.

```bash
npm run dev    # dev server
npm run build  # production build
```

Route structure:
- `/` — Welcome; `/eip-7906-explained`, `/clear-signing`, `/legacy-frameworks` — background reading
- `/demo` — scenario map; `/account-setup` — one-time smart-account/Safe provisioning
- `/unlimited-approval`, `/control-plane-takeover`, `/hidden-eth-drain`, `/mev-sandwich`, `/oracle-manipulation`, `/proxy-swap` — threat demos
- `/private-swap` — bonus shielded-pool demo
- `/contract/:address` — per-contract detail with source viewer
- `/tx/:hash` — transaction detail

`frontend/src/contracts/` contains deploy helpers, an address registry (name + source lookup for the explorer), and ABI definitions.

## Hardhat v3 specifics

This project uses Hardhat **v3** (not v2). Key differences from v2:
- `package.json` must have `"type": "module"` (ESM).
- Plugins are imported as ES default imports and listed in `config.plugins` — **not** registered via side-effect imports.
- The Solidity compile task is `npx hardhat build` (not `compile`).
- `@nomicfoundation/hardhat-toolbox` v7 is a stub that prints an error; individual plugins (`hardhat-ethers`, `hardhat-mocha`, `hardhat-chai-matchers`) are installed separately.
- `viaIR: true` is required in the solidity settings (needed for the optimizer on complex contracts).
