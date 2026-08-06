// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC6900ExecutionHookModule} from "./IERC6900Hooks.sol";
import {EIP7906ExtendedLibrary} from "../shared/EIP7906ExtendedLibrary.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title SlotProtectionHook
/// @notice ERC-6900 post-execution hook that prevents writes to a specific
///         (contract, slot) pair, detected via TXTRACE storage traces.
///
/// Covers: Safe control-plane takeover (protect threshold/guard slots) and proxy
///         implementation swap (protect EIP-1967 slot).
///
/// hookData (64 bytes): abi.encode(address protectedContract, bytes32 protectedSlot)
contract SlotProtectionHook is IERC6900ExecutionHookModule {
    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    function preExecutionHook(uint32, address, uint256, bytes calldata data)
        external pure override returns (bytes memory hookData)
    {
        return data[:64];
    }

    function postExecutionHook(uint32, bytes calldata preExecHookData) external view override {
        (address protectedContract, bytes32 protectedSlot) =
            abi.decode(preExecHookData, (address, bytes32));
        EIP7906ExtendedLibrary.checkSlotProtection(txTraceOracle, protectedContract, protectedSlot);
    }
}
