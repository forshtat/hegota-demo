// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseGuard} from "@safe-global/safe-contracts/contracts/base/GuardManager.sol";
import {Enum} from "@safe-global/safe-contracts/contracts/common/Enum.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title SafeIntegrityGuard
/// @notice Gnosis Safe guard that prevents any transaction from modifying the Safe's own
///         control-plane storage slots (guard address, threshold).
///
/// Threat: a multisig transaction that appears to be a routine action secretly changes the
///         Safe's threshold or guard config, enabling an attacker to gain unilateral control.
///
/// Detection: after execution, scan TXTRACE storage changes; if any write targets the
///            Safe's own address at a protected slot → revert.
///
/// Protected slots in MockSafe storage layout:
///   slot 0: guard address
///   slot 1: threshold
contract SafeIntegrityGuard is BaseGuard {
    error SafeControlPlaneModified(bytes32 slot);

    bytes32 constant SLOT_GUARD      = bytes32(uint256(0));
    bytes32 constant SLOT_THRESHOLD  = bytes32(uint256(1));

    address public immutable txTraceOracle;
    address public immutable eventDataOracle;
    address public immutable safeAddress;

    constructor(address _safeAddress) {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
        safeAddress = _safeAddress;
    }

    function checkTransaction(
        address, uint256, bytes memory, Enum.Operation,
        uint256, uint256, uint256, address, address payable, bytes memory, address
    ) external pure override {}

    function checkAfterExecution(bytes32, bool) external view override {
        uint256 n = TxTraceLib.query(txTraceOracle, TxTraceLib.STORAGE_COUNT, 0);
        for (uint256 i = 0; i < n; i++) {
            address addr = address(uint160(
                TxTraceLib.query(txTraceOracle, TxTraceLib.STORAGE_ADDRESS, i)
            ));
            if (addr != safeAddress) continue;

            bytes32 slot = bytes32(TxTraceLib.query(txTraceOracle, TxTraceLib.STORAGE_SLOT, i));
            if (slot == SLOT_GUARD || slot == SLOT_THRESHOLD) {
                revert SafeControlPlaneModified(slot);
            }
        }
    }
}
