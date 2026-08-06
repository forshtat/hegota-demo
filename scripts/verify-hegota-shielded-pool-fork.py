#!/usr/bin/env python3
"""Stage 1 fork proof: shield, transfer, then withdraw as the TRUE 4-frame transaction
the private-swap design needs -- VERIFY(self-pay) + SENDER(pool.withdraw, the settle
frame) + DEFAULT(no-op stand-in for the future swap) + POST_TX(no-op stand-in for the
future EIP-7906 assertion) -- against our forked, redeployed pool
(contracts/hegota/shielded-pool/, see pool-issues.md). An unmodified upstream pool's
_spend()/verifyFrameApprove() require the settle frame to be the transaction's literal
last frame (frames == 2 or 3) and would revert NotFaithfulShape on a 4-frame tx; our
fork additionally accepts frames == 4 with the settle frame at index 1. Confirming this
mines with status=1 and NoteSpent/LeafAppended/WithdrawalCredited events fire is the
concrete go/no-go signal for the whole feature.

Reuses the pool's own devnet/frametx.py, devnet/pool_frametx.py helpers, and
wallet/gen_smoke.py's fixture UNMODIFIED (no submodule files are edited) -- but does its
own transaction signing/sending rather than calling pool_frametx.py's build_and_send(),
because that function has two real, unrelated bugs versus the CURRENT live-devnet wire
format (confirmed by byte-exact comparison against this repo's own working
frontend/src/frametx.ts output for an otherwise-identical transaction). Both are
documented in pool-issues.md, along with a third, separate bug this run's fixture
generation depends on being fixed for (the sourceId()/source_id encoding mismatch, fixed
in our fork's ShieldedPoolLogic.sol and ShieldedPoolDispatcher.yul):

  1. devnet/frametx.py's `FrameSig.SECP256K1 = 0` uses the OLD 2-value signature-scheme
     wire enum; the current wire format is 3-valued (0=ARBITRARY, 1=SECP256K1, 2=P256).
     Worked around below by monkeypatching the class attribute (not editing their file).
  2. pool_frametx.py's build_and_send() encodes the signature's first byte as
     `s.v + 27` (legacy Ethereum v=27/28). The current wire format wants the raw
     recovery id (yParity, 0/1) with no offset -- confirmed because the SAME private key
     signing the SAME sig_hash via eth_keys and via ethers.js's SigningKey produces
     IDENTICAL r/s (both use RFC 6979 deterministic ECDSA) but the byte pool_frametx.py
     emits is 27 more than what frametx.ts emits. Worked around below by building/signing
     transactions directly instead of calling build_and_send().

Usage: python3 scripts/verify-hegota-shielded-pool-fork.py
Env: HEGOTA_RPC_URL, HEGOTA_PRIVATE_KEY (from .env), and the VITE_HEGOTA_POOL_* addresses
in frontend/.env (written by scripts/deploy-hegota-shielded-pool.mjs). Requires a fixture
at lib/minimal-shielded-pool/wallet/artifacts/our_pool_fixture.json generated against the
deployed pool's (fixed) sourceId() value -- see pool-issues.md for the gen_smoke.py
invocation.
"""
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEVNET = ROOT / "lib/minimal-shielded-pool/devnet"
WALLET = ROOT / "lib/minimal-shielded-pool/wallet"
sys.path.insert(0, str(DEVNET))
sys.path.insert(0, str(WALLET))

import frametx  # noqa: E402
frametx.FrameSig.SECP256K1 = 1  # workaround for bug 1, see module docstring

from frametx import Frame, FrameSig, FrameTx  # noqa: E402
import pool_frametx as pft  # noqa: E402
from eth_keys import keys  # noqa: E402


def load_env(path):
    env = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line.strip())
        if m:
            env[m.group(1)] = m.group(2)
    return env


def sign(pk, tx):
    """Correct (yParity, no +27) signing -- workaround for bug 2, see module docstring."""
    s = pk.sign_msg_hash(tx.sig_hash())
    sig_bytes = bytes([s.v]) + s.r.to_bytes(32, "big") + s.s.to_bytes(32, "big")
    return sig_bytes


def build_send_wait(url, pk, signer, frames, nonce_keys, nonce_seq, refs=None, label=""):
    chain_id = int(pft.rpc(url, "eth_chainId", []), 16)
    blk = pft.rpc(url, "eth_getBlockByNumber", ["latest", False])
    base_fee = int(blk.get("baseFeePerGas", "0x0"), 16)
    max_priority = 1000
    max_fee = base_fee * 4 + max_priority

    def build(sig):
        return FrameTx(chain_id=chain_id, nonce_keys=nonce_keys, nonce_seq=nonce_seq, sender=signer,
                        frames=frames, signatures=[sig], max_priority_fee=max_priority, max_fee=max_fee,
                        recent_root_refs=refs)

    unsigned = build(FrameSig(FrameSig.SECP256K1, signer, b"", b""))
    sig_bytes = sign(pk, unsigned)
    tx = build(FrameSig(FrameSig.SECP256K1, signer, b"", sig_bytes))
    raw = "0x" + tx.raw().hex()

    sim = pft.simulate(url, raw)
    print(f"  [{label}] simulate: valid={sim.get('valid') if sim else None} "
          f"shape={sim.get('prefixShape') if sim else None} violation={sim.get('violation') if sim else None}")
    if sim is None:
        raise SystemExit(f"[{label}] simulate endpoint unavailable; refusing to send blind")
    if not sim.get("valid"):
        raise SystemExit(f"[{label}] simulate INVALID: {sim.get('violation')}")

    txhash = pft.rpc(url, "eth_sendRawTransaction", [raw])
    print(f"  [{label}] submitted: {txhash}")
    for _ in range(30):
        rcpt = pft.rpc(url, "eth_getTransactionReceipt", [txhash])
        if rcpt:
            status = int(rcpt.get("status", "0x0"), 16)
            print(f"  [{label}] MINED block={int(rcpt['blockNumber'],16)} status={rcpt.get('status')} "
                  f"gasUsed={int(rcpt.get('gasUsed','0x0'),16)}")
            if status != 1:
                raise SystemExit(f"[{label}] tx reverted")
            return rcpt
        time.sleep(2)
    raise SystemExit(f"[{label}] not mined within timeout")


def main():
    root_env = load_env(ROOT / ".env")
    fe_env = load_env(ROOT / "frontend/.env")
    url = root_env.get("HEGOTA_RPC_URL", "https://rpc1.hegota.ethrex.xyz")
    priv = root_env.get("HEGOTA_PRIVATE_KEY")
    if not priv:
        raise SystemExit("HEGOTA_PRIVATE_KEY not set in .env")

    cfg = {
        "rpc": url,
        "pool": fe_env["VITE_HEGOTA_POOL"],
        "sourceId": fe_env["VITE_HEGOTA_POOL_SOURCE_ID"],
    }
    pool = int(cfg["pool"], 16)
    pk = keys.PrivateKey(bytes.fromhex(priv.removeprefix("0x")))
    signer = int.from_bytes(pk.public_key.to_canonical_address(), "big")

    fix_path = WALLET / "artifacts/our_pool_fixture.json"
    if not fix_path.exists():
        raise SystemExit(f"fixture not found at {fix_path}; run gen_smoke.py first")
    fix = json.loads(fix_path.read_text())

    # --- 1. shield: VERIFY(self, flags=0x03) + SENDER(pool, value, shield(inner)) ---
    print("\n=== shield ===")
    nonce = int(pft.rpc(url, "eth_getTransactionCount", [pk.public_key.to_checksum_address(), "latest"]), 16)
    calldata = pft.cast_calldata("shield(bytes32)", fix["inner_a"])
    frames = [
        Frame(mode=1, flags=0x03, target=signer, gas_limit=80_000, value=0, data=b""),
        Frame(mode=2, flags=0, target=pool, gas_limit=10_000_000, value=int(fix["shield_value"]), data=calldata),
    ]
    rcpt = build_send_wait(url, pk, signer, frames, [0], nonce, label="shield")
    slot_shield = int(rcpt["blockNumber"], 16)

    # --- 2. transfer: VERIFY(pool, self-pay) + SENDER(pool, transfer(Spend)) ---
    print("\n=== transfer ===")
    e_t = json.loads(json.dumps(fix["transfer"]))
    protocol_nonces_t = sorted([int(e_t["nf1"], 16), int(e_t["nf2"], 16)])
    calldata_t = pft.cast_calldata(f"transfer({pft.SPEND_TUPLE})", pft.spend_args(e_t))
    refs_t = [pft.recent_root_ref(url, cfg, {"slot": slot_shield, "root": e_t["root"]})]
    frames_t = [
        Frame(mode=1, flags=0x03, target=pool, gas_limit=350_000, value=0, data=b""),
        Frame(mode=2, flags=0, target=pool, gas_limit=10_000_000, value=0, data=calldata_t),
    ]
    rcpt_t = build_send_wait(url, pk, pool, frames_t, protocol_nonces_t, 0, refs_t, label="transfer")
    slot_transfer = int(rcpt_t["blockNumber"], 16)

    # --- 3. withdraw as the TRUE 4-frame shape (the actual fork test) ---
    print("\n=== withdraw as VERIFY+SENDER+DEFAULT+POST_TX (the fork test) ===")
    e_w = json.loads(json.dumps(fix["withdraw"]))
    protocol_nonces_w = sorted([int(e_w["nf1"], 16), int(e_w["nf2"], 16)])
    calldata_w = pft.cast_calldata(f"withdraw({pft.SPEND_TUPLE},address)", pft.spend_args(e_w), fix["recipient"])
    refs_w = [pft.recent_root_ref(url, cfg, {"slot": slot_transfer, "root": e_w["root"]})]
    # Exactly 4 total frames, settle frame at index 1 -- the shape our fork's
    # `case 4 { settleIndex := 1 selfPay := 1 }` (ShieldedPoolDispatcher.yul) and
    # `(frames == 2 || frames == 4) && frameIndex == 1` (ShieldedPoolLogic.sol) accept
    # and an unmodified upstream pool rejects outright (frames == 4 is not 2 or 3).
    # Frames 2/3 are no-op stand-ins here for the eventual swap/assertion frames.
    frames_w = [
        Frame(mode=1, flags=0x03, target=pool, gas_limit=350_000, value=0, data=b""),
        Frame(mode=2, flags=0, target=pool, gas_limit=10_000_000, value=0, data=calldata_w),
        Frame(mode=0, flags=0, target=signer, gas_limit=21_000, value=0, data=b""),
        Frame(mode=3, flags=0, target=signer, gas_limit=21_000, value=0, data=b""),
    ]
    rcpt_w = build_send_wait(url, pk, pool, frames_w, protocol_nonces_w, 0, refs_w, label="withdraw(4-frame)")
    print("logs:", json.dumps(rcpt_w.get("logs", []), indent=1))
    print("\nFORK CONFIRMED: the true 4-frame withdraw (VERIFY+SENDER+DEFAULT+POST_TX, "
          "settle frame at index 1) mined successfully (status=1) against our forked pool.")


if __name__ == "__main__":
    main()
