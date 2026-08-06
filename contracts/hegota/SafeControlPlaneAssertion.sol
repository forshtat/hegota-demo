// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title SafeControlPlaneAssertion
/// @notice EIP-7906 POST_TX-frame assertion contract for the Control-Plane Takeover demo.
/// Same shape as MinOutputAssertion.sol/ExactBeneficiaryAssertion.sol (no constructor
/// config, deploys its own oracle pair, called directly as a POST_TX frame's target) --
/// scans the `STORAGE_*` TXTRACE family (raw per-slot storage-write records, same family
/// SafeIntegrityGuard.sol / ProxyIntegrityGuard.sol already use) for any write touching a
/// specific Safe's threshold slot or guard slot, reverting if found.
///
/// This mirrors SafeIntegrityGuard.sol's checkAfterExecution logic exactly, EXCEPT for the
/// slot numbers: SafeIntegrityGuard.sol was written against a mock Safe's storage layout
/// (slot 0 = guard, slot 1 = threshold) -- a deliberate fix, not a copy of those wrong
/// values. This contract uses the REAL Gnosis Safe slot layout instead, confirmed directly
/// against node_modules/safe-global/safe-contracts/contracts/libraries/SafeStorage.sol
/// (slot 4 = threshold) and contracts/base/GuardManager.sol (guard at
/// keccak256("guard_manager.guard.address") - 1) -- matching
/// contracts/hegota/MinimalSafeStub.sol's layout and
/// contracts/hegota/MaliciousSafeDelegate.sol's target slots exactly.
contract SafeControlPlaneAssertion {
    error SafeControlPlaneModified(address safe, bytes32 slot);

    bytes32 constant SLOT_THRESHOLD = bytes32(uint256(4));

    // keccak256("guard_manager.guard.address") - 1, copied verbatim from
    // GuardManager.GUARD_STORAGE_SLOT (@safe-global/safe-contracts/contracts/base/GuardManager.sol)
    // -- same constant as MinimalSafeStub.sol / MaliciousSafeDelegate.sol.
    bytes32 constant SLOT_GUARD =
        0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8;

    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    /// @notice Assert that no write during the transaction touched `safe`'s own threshold
    ///         slot or guard slot. Reverts with SafeControlPlaneModified otherwise.
    function assertSafeControlPlaneUnchanged(address safe) external view {
        uint256 n = TxTraceLib.query(txTraceOracle, TxTraceLib.STORAGE_COUNT, 0);

        for (uint256 i = 0; i < n; i++) {
            address addr = address(uint160(
                TxTraceLib.query(txTraceOracle, TxTraceLib.STORAGE_ADDRESS, i)
            ));
            if (addr != safe) continue;

            bytes32 slot = bytes32(TxTraceLib.query(txTraceOracle, TxTraceLib.STORAGE_SLOT, i));
            if (slot == SLOT_THRESHOLD || slot == SLOT_GUARD) {
                revert SafeControlPlaneModified(safe, slot);
            }
        }
    }
}
