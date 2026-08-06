// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC7579Hook} from "./IERC7579Hook.sol";
import {EIP7906ExtendedLibrary} from "../shared/EIP7906ExtendedLibrary.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title SlotProtectionHook
/// @notice ERC-7579 hook that prevents writes to a specific (contract, slot) pair,
///         detected via TXTRACE storage traces.
///
/// Covers: Safe control-plane takeover (protect threshold/guard slots) and proxy
///         implementation swap (protect EIP-1967 slot).
///
/// hookData (64 bytes): abi.encode(address protectedContract, bytes32 protectedSlot)
contract SlotProtectionHook is IERC7579Hook {
    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    function preCheck(address, uint256, bytes calldata msgData)
        external pure override returns (bytes memory hookData)
    {
        return msgData[:64];
    }

    function postCheck(bytes calldata hookData) external view override {
        (address protectedContract, bytes32 protectedSlot) =
            abi.decode(hookData, (address, bytes32));
        EIP7906ExtendedLibrary.checkSlotProtection(txTraceOracle, protectedContract, protectedSlot);
    }
}
