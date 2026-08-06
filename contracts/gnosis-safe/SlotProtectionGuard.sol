// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseGuard} from "@safe-global/safe-contracts/contracts/base/GuardManager.sol";
import {Enum} from "@safe-global/safe-contracts/contracts/common/Enum.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title SlotProtectionGuard
/// @notice Gnosis Safe guard that uses TXTRACE to prevent any transaction from
///         writing to a configurable set of protected storage slots.
contract SlotProtectionGuard is BaseGuard {
    error ProtectedSlotModified(address contractAddr, bytes32 slot);

    address public immutable txTraceOracle;
    address public immutable eventDataOracle;
    mapping(bytes32 => bool) public protectedSlots;

    constructor(bytes32[] memory slots) {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
        for (uint256 i = 0; i < slots.length; i++) {
            protectedSlots[slots[i]] = true;
        }
    }

    function checkTransaction(
        address, uint256, bytes memory, Enum.Operation,
        uint256, uint256, uint256, address, address payable, bytes memory, address
    ) external pure override {}

    function checkAfterExecution(bytes32, bool) external view override {
        uint256 n = TxTraceLib.query(txTraceOracle, TxTraceLib.STORAGE_COUNT, 0);
        for (uint256 i = 0; i < n; i++) {
            bytes32 slot = bytes32(TxTraceLib.query(txTraceOracle, TxTraceLib.STORAGE_SLOT, i));
            if (protectedSlots[slot]) {
                address contractAddr = address(uint160(
                    TxTraceLib.query(txTraceOracle, TxTraceLib.STORAGE_ADDRESS, i)
                ));
                revert ProtectedSlotModified(contractAddr, slot);
            }
        }
    }
}
