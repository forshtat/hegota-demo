// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title MinimalSafeStub
/// @notice TEMPORARY development stand-in for the real Gnosis Safe singleton
/// (safe-global/safe-contracts Safe.sol), used only because deploying that real, unmodified
/// ~23.6KB singleton to the Hegotá devnet is currently blocked by an upstream ethrex
/// gas-accounting bug: Hegotá inherits Amsterdam's EIP-8037 per-byte state-gas repricing for
/// code deposits but not its compensating tx-admission gas-limit exemption, so any deployment
/// needing more than ~16.7M gas -- the real Safe singleton needs ~36.75M -- is rejected
/// outright before it ever reaches VM execution. See HEGOTA_GAS_CAP_REPORT.md at the repo
/// root for the full diagnosis; that bug is accepted as given here, not re-derived.
///
/// Deployed through the REAL, unmodified safe-global/safe-contracts SafeProxyFactory +
/// SafeProxy (both small enough to deploy on Hegotá today) as a drop-in replacement
/// *singleton* only. Each user's Safe is therefore a genuine SafeProxy delegatecalling into
/// this stub, exactly as it would delegatecall into the real Safe.sol -- so
/// frontend/src/hegotaSafeAccount.ts's existing CREATE2 address prediction and
/// createProxyWithNonce provisioning flow work completely unchanged, and swapping this stub
/// back out for the real Safe singleton
/// later is purely a `VITE_HEGOTA_SAFE_SINGLETON` address change in frontend/.env -- the
/// proxy factory, the proxy bytecode, and every caller of this contract stay exactly as they
/// are.
///
/// Because each Safe is a SafeProxy delegatecalling in, ALL of this contract's storage
/// reads/writes happen in the *proxy's* storage, never this contract's own -- so the slot
/// layout below must exactly match what SafeProxy's fallback (slot 0 = singleton address, see
/// node_modules/safe-global/safe-contracts/contracts/proxies/SafeProxy.sol and
/// common/Singleton.sol) and SafeControlPlaneAssertion.sol expect:
///   - slot 0: reserved for the proxy's own singleton pointer -- never written here, just
///     reserved so nothing else collides with it (mirrors Singleton.sol exactly).
///   - slots 1-3: reserved filler, mirroring the real Safe's ModuleManager/OwnerManager
///     mapping slots, so `threshold` below lands on slot 4 exactly like the real Safe's does.
///   - slot 4: `threshold` -- the real Safe's exact slot (confirmed against
///     node_modules/safe-global/safe-contracts/contracts/base/OwnerManager.sol: ModuleManager's
///     `modules` mapping at slot 1, OwnerManager's `owners` mapping at slot 2, `ownerCount` at
///     slot 3, `threshold` at slot 4) -- checked directly by SafeControlPlaneAssertion.sol.
///   - the guard address, at `keccak256("guard_manager.guard.address") - 1` (confirmed
///     directly against node_modules/safe-global/safe-contracts/contracts/base/GuardManager.sol's
///     GUARD_STORAGE_SLOT constant), stored via raw assembly sstore/sload exactly like the
///     real GuardManager -- also checked directly by SafeControlPlaneAssertion.sol.
///
/// Deliberately skipped (real Safe has these; this demo doesn't touch them): module manager,
/// fallback handler, gas refund/payment, EIP-1271 nested signatures, multi-owner threshold
/// math, approved-hash/contract-signature co-signing, and guard *hook* invocation
/// (checkTransaction/checkAfterExecution) -- only the guard's storage slot is replicated,
/// since SafeControlPlaneAssertion.sol inspects it directly (POST_TX-frame storage
/// inspection) rather than this stub calling into it as an active guard. Single owner,
/// 1-of-1 only.
contract MinimalSafeStub {
    error AlreadySetUp();
    error InvalidOwnerCount();
    error InvalidSignature();
    error ExecutionFailed();

    // --- storage layout (see contract-level comment for why each slot is where it is) ---
    address private singletonSlot; // slot 0 -- reserved, matches Singleton.sol; never written
    uint256 private __gap1; // slot 1 -- reserved (mirrors ModuleManager's `modules` mapping)
    uint256 private __gap2; // slot 2 -- reserved (mirrors OwnerManager's `owners` mapping)
    uint256 private __gap3; // slot 3 -- reserved (mirrors OwnerManager's `ownerCount`)
    uint256 internal threshold; // slot 4 -- matches the real Safe's slot exactly
    address public owner; // slot 5 -- single owner; no linked list, 1-of-1 only
    uint256 public nonce; // slot 6

    // keccak256("guard_manager.guard.address") - 1, copied verbatim from
    // GuardManager.GUARD_STORAGE_SLOT (@safe-global/safe-contracts/contracts/base/GuardManager.sol)
    bytes32 internal constant GUARD_STORAGE_SLOT =
        0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8;

    // Both copied verbatim from Safe.sol, so a signature valid against a real Safe's domain
    // separator + typehash is byte-for-byte valid against this stub's too.
    // keccak256("EIP712Domain(uint256 chainId,address verifyingContract)")
    bytes32 private constant DOMAIN_SEPARATOR_TYPEHASH =
        0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218;
    // keccak256("SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)")
    bytes32 private constant SAFE_TX_TYPEHASH =
        0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8;

    event ChangedGuard(address indexed guard);
    event ExecutionSuccess(bytes32 indexed txHash);

    /// @notice Poisons the singleton itself (mirrors Safe.sol's own constructor exactly): by
    /// setting `threshold` directly, `setup(...)` can never succeed on this contract when
    /// called directly, since setup requires `threshold == 0`. Irrelevant to every real
    /// per-user Safe, since a SafeProxy delegatecalling in never runs this constructor --
    /// constructors only ever execute in the deploying contract's own storage context.
    constructor() {
        threshold = 1;
    }

    modifier authorized() {
        require(msg.sender == address(this), "GS031");
        _;
    }

    /// @notice Minimal stand-in for Safe.setup(...): only `_owners[0]` and `_threshold` are
    /// used (1-of-1 only). `to`/`data`/`fallbackHandler`/`paymentToken`/`payment`/
    /// `paymentReceiver` are accepted -- so hegotaSafeAccount.ts's existing buildSetupData()
    /// call (which ABI-encodes the real Safe's setup() signature) needs no changes -- but
    /// ignored, since this stub has no module manager, fallback handler, or payment logic.
    function setup(
        address[] calldata _owners,
        uint256 _threshold,
        address, /* to */
        bytes calldata, /* data */
        address, /* fallbackHandler */
        address, /* paymentToken */
        uint256, /* payment */
        address /* paymentReceiver */
    ) external {
        if (threshold != 0) revert AlreadySetUp();
        if (_owners.length != 1 || _threshold != 1) revert InvalidOwnerCount();
        owner = _owners[0];
        threshold = 1;
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_SEPARATOR_TYPEHASH, block.chainid, this));
    }

    function encodeTransactionData(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) public view returns (bytes memory) {
        bytes32 safeTxHash = keccak256(
            abi.encode(
                SAFE_TX_TYPEHASH,
                to,
                value,
                keccak256(data),
                operation,
                safeTxGas,
                baseGas,
                gasPrice,
                gasToken,
                refundReceiver,
                _nonce
            )
        );
        return abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator(), safeTxHash);
    }

    function getTransactionHash(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) public view returns (bytes32) {
        return keccak256(
            encodeTransactionData(to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, _nonce)
        );
    }

    /// @notice Matches the real Safe's execTransaction signature closely enough that
    /// safeExec.ts's existing SafeTx signer (domain: chainId + verifyingContract only, no
    /// name/version) works against this stub with zero changes. Genuinely dispatches via
    /// `operation == 0` -> CALL, `operation == 1` -> DELEGATECALL -- the real, load-bearing
    /// behavior Task 11's control-plane-takeover attack depends on.
    function execTransaction(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) external payable returns (bool success) {
        // Split into two private calls (mirroring Safe.sol's own use of `{ }` scope blocks
        // to limit variable lifetime) purely to keep the IR optimizer's live variable count
        // low enough to avoid a "stack too deep" error with this many parameters -- no
        // change in semantics from a single inline function body.
        bytes32 txHash = _verifyAndBumpNonce(to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, signatures);
        success = _dispatch(to, value, data, operation);

        // Mirrors the real Safe's behavior when safeTxGas == 0 && gasPrice == 0 (always the
        // case for safeExec.ts's calls): the whole execTransaction reverts on a failed inner
        // call rather than just emitting a failure event and returning false.
        if (!success && safeTxGas == 0 && gasPrice == 0) revert ExecutionFailed();

        emit ExecutionSuccess(txHash);
    }

    function _verifyAndBumpNonce(
        address to,
        uint256 value,
        bytes memory data,
        uint8 operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        bytes memory signatures
    ) private returns (bytes32 txHash) {
        txHash = getTransactionHash(to, value, data, operation, safeTxGas, baseGas, gasPrice, gasToken, refundReceiver, nonce);
        nonce += 1;
        if (ECDSA.recover(txHash, signatures) != owner) revert InvalidSignature();
    }

    function _dispatch(address to, uint256 value, bytes memory data, uint8 operation) private returns (bool success) {
        if (operation == 0) {
            (success,) = to.call{ value: value }(data);
        } else if (operation == 1) {
            (success,) = to.delegatecall(data);
        } else {
            revert ExecutionFailed();
        }
    }

    /// @notice Matches the real GuardManager.setGuard exactly (same slot, same `authorized`
    /// self-call restriction) so a legitimately-installed guard's storage looks identical to
    /// what a real Safe would produce -- only reachable via execTransaction targeting this
    /// contract itself (to == the Safe, operation == 0).
    function setGuard(address guard) external authorized {
        bytes32 slot = GUARD_STORAGE_SLOT;
        assembly {
            sstore(slot, guard)
        }
        emit ChangedGuard(guard);
    }

    /// @notice Matches the real Safe's StorageAccessible.getStorageAt(offset, length) --
    /// reads `length` words starting at storage slot `offsetSlot`. Not required by TXTRACE
    /// (which reports raw storage writes independent of any getter), but kept for interface
    /// parity and ad-hoc off-chain verification.
    function getStorageAt(uint256 offsetSlot, uint256 length) external view returns (bytes memory) {
        bytes memory result = new bytes(length * 32);
        for (uint256 index = 0; index < length; index++) {
            assembly {
                let word := sload(add(offsetSlot, index))
                mstore(add(add(result, 0x20), mul(index, 0x20)), word)
            }
        }
        return result;
    }

    function getOwners() external view returns (address[] memory result) {
        result = new address[](1);
        result[0] = owner;
    }

    function getThreshold() external view returns (uint256) {
        return threshold;
    }
}
