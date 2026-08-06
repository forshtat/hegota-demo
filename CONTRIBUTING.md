# Contributing

This repo is a Hardhat v3 integration test suite validating **EIP-7906**'s `TXTRACE` (`0xB6`)
and `EVENTDATACOPY` (`0xB7`) opcodes through four Account Abstraction frameworks, plus the
interactive frontend demo at [eip7906.forshtat.com](https://eip7906.forshtat.com/) (see
[README.md](./README.md) for what the demo shows). See `CLAUDE.md` for full architectural detail
— this file covers the essentials to get building.

## Prerequisites

- Node.js 20+
- An **[EthRex](https://github.com/lambdaclass/ethrex)** node built from source with EIP-7906 +
  EIP-8141 support enabled — the test suite runs against this reference EVM implementation.
  It will not pass against Hardhat's built-in EVM or any standard node.

## Setup

### 1. Clone with submodules

```bash
git clone <this-repo>
cd eip7906_validation

git submodule update --init lib/delegation-framework lib/minimal-shielded-pool
git -C lib/delegation-framework submodule update --init --depth 1 \
    lib/account-abstraction lib/erc7579-implementation
```

### 2. Install dependencies

```bash
npm install
```

`.npmrc` sets `legacy-peer-deps=true` automatically — `@safe-global/safe-contracts` declares a
peer dependency on ethers v5, which only affects its JS side, not the Solidity we use.

### 3. Configure and run a local EthRex node

```bash
cp .env.example .env
```

Edit `.env`:

```
ETHREX_RPC_URL=http://localhost:8545
ETHREX_CHAIN_ID=1337
ETHREX_PRIVATE_KEY=0x<funded-key>
```

Then, from the EthRex repo:

```bash
make dev          # cargo run --release -- --dev --datadir memory
```

### 4. Compile and test

```bash
npx hardhat build                          # compile all contracts
npx hardhat test --network ethrex          # run all suites
npm run test:metamask                      # MetaMask enforcers only
npm run test:safe                          # Gnosis Safe guards only
npm run test:erc6900                       # ERC-6900 hooks only
npm run test:erc7579                       # ERC-7579 hooks only
```

## Threat coverage

Six attack scenarios, each implemented as parallel policy contracts across four Account
Abstraction frameworks:

- **ERC-7579** — hook modules (`IERC7579Hook`)
- **ERC-6900** — execution hook modules (`IERC6900ExecutionHookModule`)
- **Gnosis Safe** — transaction guards (`ITransactionGuard`)
- **MetaMask Delegation (ERC-7710)** — caveat enforcers (`ICaveatEnforcer`)

See the README's threat table for what each scenario models, and `CLAUDE.md`'s "Policy contracts
and what they validate" section for the exact contract-to-threat mapping.

## Running the frontend locally

```bash
npm run deploy       # deploys ~60 contracts to your local EthRex node, writes frontend/.env
npm run dev           # starts the Vite dev server
```

Open [http://localhost:5173](http://localhost:5173). The frontend connects via an injected
web3 provider (MetaMask or any EIP-1193 wallet) or the built-in demo wallet — no deployment
popups, you sign only the attack and mitigation transactions.

Optional WalletConnect support: add a free project ID from
[cloud.walletconnect.com](https://cloud.walletconnect.com) to `frontend/.env`:

```
VITE_WALLETCONNECT_PROJECT_ID=<your-project-id>
```

### The Hegotá devnet stack (live demo backend)

The live demo runs against **Hegotá**, a public devnet integrating EIP-7906 with EIP-8141
(frame transactions), EIP-8250 (keyed nonces), and EIP-8272 (recent-root references). Deploying
that stack yourself requires a funded key (faucet: `https://faucet.hegota.ethrex.xyz`) and runs
through a sequence of scripts — see `CLAUDE.md`'s "Hegotá devnet" section for the full deploy
order and what each script provisions.

```bash
npm run deploy:hegota
```

## Code layout

- `contracts/` — Solidity policy contracts, organized by framework (`erc7579/`, `erc6900/`,
  `gnosis-safe/`, `metamask-enforcers/`), plus `shared/` (oracle library, test fixtures) and
  `hegota/` (the Hegotá-specific POST_TX assertion demo, including the shielded-pool fork).
- `test/` — Mocha/Chai integration tests, mirroring the `contracts/` framework split.
- `frontend/` — the React/Vite demo app.
- `scripts/` — deployment and live-verification scripts (`.mjs`, run with plain Node).

Before opening a PR, make sure `npx hardhat build` and `npx tsc -p tsconfig.frontend.json
--noEmit` both stay clean.
