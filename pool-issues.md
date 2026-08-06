# Issues found integrating soispoke/minimal-shielded-pool with Hegotá (Stage 1)

Findings from vendoring `soispoke/minimal-shielded-pool` (pinned at `lib/minimal-shielded-pool`,
commit `fb02e3c`, "Make self-payment canonical", 2026-07-15) for the private-swap feature — a
transaction chaining a pool withdrawal into a swap and an EIP-7906 `POST_TX` assertion. All four
issues below were found live against the public Hegotá devnet (`rpc1.hegota.ethrex.xyz`), not in
a local simulator, and all are reproducible with the scripts referenced in each section.

Two are real bugs in the pool's own code (fixed in our fork, contracts/hegota/shielded-pool/).
Two are bugs in its Python tooling (worked around in our test scripts, no submodule files edited).
None are bugs in ethrex.

## Fork 1: the settle frame's shape gate (deliberate, minimal relaxation)

**File**: `contracts/hegota/shielded-pool/ShieldedPoolLogic.sol` (`_spend()`) and
`ShieldedPoolDispatcher.yul` (`verifyFrameApprove()`).

Upstream's `_spend()` and the dispatcher's frame-0 VERIFY logic both require the transaction to
have **exactly** 2 frames (self-pay: `VERIFY, SENDER`) or 3 frames (paymaster:
`VERIFY, VERIFY, SENDER`), with the settle (`SENDER`) frame as the transaction's **literal last
frame**. This is intentional, hardened design — their `devnet/REVIEW.md` documents a security
review that found and closed a double-credit/indirection bug specifically by pinning this shape.

Our private-swap design needs two more frames after the settle frame — `DEFAULT` (the swap) and
`POST_TX` (the EIP-7906 assertion) — which the upstream gate rejects outright before ever
reaching the swap logic.

**The fix**: both files gained one additional accepted shape, `frames == 4` with the settle frame
still at index 1 (self-pay only; we don't use the paymaster path). Everything else is untouched,
specifically the `settleTarget == address(this)` / direct-target check that is what actually
prevents the indirection bug the security review found — our trailing frames never call the pool
again, so that protection still holds. The Solidity diff is one boolean expression; the Yul diff
is one `case 4` arm in a `switch`. Confirmed the diff is otherwise comment-only:
```
- bool selfPayShape = frames == 2 && frameIndex == 1;
+ bool selfPayShape = (frames == 2 || frames == 4) && frameIndex == 1;
```
```yul
  case 2 { settleIndex := 1 selfPay := 1 }
  case 3 { settleIndex := 2 }
+ case 4 { settleIndex := 1 selfPay := 1 }
  default { fail(errNotFaithfulShape()) }
```

**Live proof**: `scripts/verify-hegota-shielded-pool-fork.py` shields, transfers, then withdraws
as a true 4-frame transaction (`VERIFY, SENDER(withdraw), DEFAULT(no-op), POST_TX(no-op)`).
Mined `0x030e236932e29d512046a68760d581dfd2cc2ea0eb8eb9da22fd858ffeebf38a` (block 31693,
`status=1`) against pool `0x77Ca353034d5B1317665D2dd49F9bF75c73F423d`, with `NoteSpent` (×2),
`LeafAppended` (×2), and `WithdrawalCredited(0x…cafebabe, 550000000000000)` all firing correctly.

An early version of this test accidentally only added *one* extra frame (3 total), which the
switch reads as the 3-frame paymaster shape and correctly rejects (the wrong frame gets checked
as if it were the settle frame) — a bug in the test, not the fork, but worth flagging: it's an
easy mistake to make when constructing these transactions by hand.

**Suggested upstream ask**: none required — this is a deliberate demo-specific extension of a
correctly-hardened check, not something upstream needs to change.

## Fork 2: `sourceId()` encoding mismatch (a real bug, not demo-specific)

**File**: `ShieldedPoolLogic.sol` (`sourceId()`) and `ShieldedPoolDispatcher.yul` (`sourceId()`).

Upstream computes `keccak256(abi.encode(address(this), SALT))` (Solidity) /
`keccak256(pad32(address()) ‖ SALT)` (Yul) — a **64-byte** preimage, since ABI encoding left-pads
an address to 32 bytes.

ethrex's actual native `RECENT_ROOT_ADDRESS` write (`crates/vm/levm/src/vm.rs`,
`recent_root_native_write`) derives `source_id = keccak256(caller ‖ salt)` over the **raw 20-byte**
caller address and the 32-byte salt — a **52-byte** preimage. ethrex's own `docs/eip-8272.md`
(divergence #5) explicitly calls this spec-conformant, not an ethrex-side divergence, citing
EIP-8272 §Root sources: "Addresses are 20 bytes."

**Effect**: `_publishRoot()` never passes `source_id` explicitly — ethrex derives it natively from
`msg.sender` at write time, so every entry is always written under the *correct* (52-byte)
`source_id`, regardless of what the contract thinks. But the contract's own read-side checks
(`_spend()`'s `refSource != sourceId()`, and the dispatcher's `RECENTROOTREFLOAD(0,0) ==
sourceId()`) compare against the *wrong* (64-byte) value — so no reference any real caller builds
against the pool's own `sourceId()` can ever validate. The recent-root binding — one of the two
things EIP-8250/8272 are supposed to prove in-EVM, per the pool's own README — is silently
unsatisfiable on a real ethrex node. A Forge test suite that mocks the predeploy would not catch
this, since it would consistently use the same (wrong) formula on both the write and read sides.

**The fix**: `abi.encodePacked(address(this), SALT)` (Solidity) and, in Yul, left-aligning the
address before hashing only 52 bytes instead of 64:
```yul
function sourceId() -> id {
    mstore(0x00, shl(96, address()))  // left-align: bytes 0..20 = address, no padding
    mstore(0x14, 0)                   // SALT, written at offset 20 so there's no gap
    id := keccak256(0x00, 0x34)       // hash exactly 52 bytes
}
```

**Live proof**: for pool `0x77Ca353034d5B1317665D2dd49F9bF75c73F423d`, `sourceId()` now returns
`0xf859c71c86e7140f7289d5a0f0306a58fec360ebeceb6dfd687a7b42c370c73b`, which exactly equals
`keccak256(rawAddr ‖ salt)` computed independently in Python. Before the fix, scanning all 8192
`RECENT_ROOT_STORAGE` ring positions for a just-shielded pool found **zero** entries under the
contract's own (wrong) `sourceId()`; the same scan under the ethrex-correct formula found the
two expected entries (the dispatcher constructor's initial empty-root publish, and the shield's).

Because `sourceId()` feeds `domain()`, which is a Groth16 public signal, this fix invalidates any
previously-generated fixture — regenerate via `gen_smoke.py --source-id=<pool's fixed sourceId>`
(no new trusted-setup ceremony needed; the verifying key is unaffected, only the witness/public
inputs change).

**Suggested upstream ask**: `minimal-shielded-pool`'s `sourceId()` in both `ShieldedPoolLogic.sol`
and the Yul files should switch from `abi.encode`/padded-address hashing to the unpadded 52-byte
form. Separately, `docs/eip-8272.md`'s divergence #5 note (or equivalent ethrex docs) could warn
integrators that Solidity's default `abi.encode(address, ...)` habits will silently produce a
wrong `source_id` for this exact reason — an easy, silent trap for the Solidity-side integrations
EIP-8272 is meant to serve.

## Tooling bug 1: `devnet/frametx.py`'s stale signature-scheme enum

**File**: `devnet/frametx.py`, `FrameSig.SECP256K1 = 0` (line 52), with the comment "wire enum
also defines 1 = P256, unused here".

The current wire format (confirmed against the live devnet, and matching this repo's own
`frontend/src/frametx.ts`) is 3-valued: `0=ARBITRARY, 1=SECP256K1, 2=P256`. `frametx.py` was
evidently vendored against an earlier 2-valued enum and never updated. Any transaction built with
this module's default constant is silently rejected by the live devnet
(`"VERIFY frame did not call APPROVE or payer not approved"`) — a generic, unhelpful error that
gives no hint the problem is the signature scheme byte.

**Confirmed** by a byte-exact diff: building the identical trivial self-verify transaction (same
key, same nonce, same fees) via `frametx.py` and via `frametx.ts` and diffing the raw RLP found
the two envelopes identical in every byte except the scheme field.

**Workaround** (not editing the submodule): `frametx.FrameSig.SECP256K1 = 1` monkeypatched before
use — see `scripts/verify-hegota-shielded-pool-fork.py`.

**Suggested upstream ask**: update the constant and comment in `devnet/frametx.py`.

## Tooling bug 2: `devnet/pool_frametx.py`'s signature `v` byte encoding

**File**: `devnet/pool_frametx.py`, `build_and_send()`: `sig = bytes([s.v + 27]) + s.r... + s.s...`.

The live wire format wants the signature's first byte to be the raw ECDSA recovery id
(`yParity`, 0 or 1) with no offset — confirmed the same way as bug 1: signing the identical
`sig_hash` with the same private key via `eth_keys` (Python) and via `ethers.js`'s `SigningKey`
produces **identical** `r`/`s` (both implement RFC 6979 deterministic ECDSA), but
`pool_frametx.py` emits a first byte exactly 27 higher than `frametx.ts` does. This is the classic
legacy Ethereum `v=27/28` convention, not what this wire format wants.

Even after fixing bug 1, this second bug on its own reproduces the same generic
`"VERIFY frame did not call APPROVE"` rejection for anything sent through `build_and_send()`.

**Workaround**: our verification script does not call `build_and_send()`; it builds and signs
frame transactions directly with `bytes([s.v]) + ...`.

**Suggested upstream ask**: fix the `+ 27` in `build_and_send()`.

## Live deployment reference (historical verification run, post-fixes)

The addresses below are a snapshot from the run that confirmed the fixes above work on real
Hegotá — not the current live deployment (redeploying via `scripts/deploy-hegota-shielded-pool.mjs`
assigns new addresses; the current ones live in `frontend/.env`). Included as proof, not as a
reference to depend on. Deployed via `scripts/deploy-hegota-shielded-pool.mjs`
(probe/PoseidonT3/PoseidonT4 reused across the sourceId-fix redeploy via
`REUSE_PROBE`/`REUSE_POSEIDON_T3`/`REUSE_POSEIDON_T4`):

| Contract | Address |
|---|---|
| Pool (`ShieldedPoolDispatcher`, forked) | `0x77Ca353034d5B1317665D2dd49F9bF75c73F423d` |
| `ShieldedPoolLogic` (forked) | `0x114f4FAb02c469D1FA30a7f8f24c1AFE44d871A7` |
| `Groth16Verifier` (unmodified, fresh local ceremony) | `0x71B4a971a495794D7665436792e940752478bE6C` |
| `PoseidonT3` (unmodified) | `0x894F6CD4b2783a7F983a0EA92C050BC5ea56Fc72` |
| `PoseidonT4` (unmodified) | `0x62a9a4e9b875A4c9919B6E26b22253b42a6E113a` |
| `EnvelopeProbe` (unmodified) | `0x2e6275A239d46C47F53a5819dc1A350Cc4bb38a9` |

`sourceId()` = `0xf859c71c86e7140f7289d5a0f0306a58fec360ebeceb6dfd687a7b42c370c73b`.

Full flow, `scripts/verify-hegota-shielded-pool-fork.py`, all `status=1`:
- **shield** 0.001 ETH: `0x45051fd795801bf3868947822c9c774476ed96ae0a2e3e543a5414d24c28cda4` (block 31620)
- **transfer** (join-split, 0.0006 ETH to a second note + change, 0.00005 ETH fee):
  `0xa3c4f2eea837291bf94daf23f46cf1210fa5775b59e01cfb6f5c9bcd471dcb3f` (block 31633)
- **withdraw**, true 4-frame shape (the fork test): `0x030e236932e29d512046a68760d581dfd2cc2ea0eb8eb9da22fd858ffeebf38a`
  (block 31693), 0.00055 ETH credited to `0x…cafebabe`

Groth16 trusted setup: a fresh local testbed ceremony (`tooling/setup.sh`, not the ceremony
originally committed upstream — this is expected and fine for a devnet demo, not a security
concern, per the pool's own README).
