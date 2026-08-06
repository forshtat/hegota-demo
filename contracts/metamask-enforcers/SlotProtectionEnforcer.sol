// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ICaveatEnforcer} from "@metamask/delegation-framework/interfaces/ICaveatEnforcer.sol";
import {ModeCode} from "@erc7579/lib/ModeLib.sol";
import {EIP7906ExtendedLibrary} from "../shared/EIP7906ExtendedLibrary.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title SlotProtectionEnforcer
/// @notice ERC-7710 afterHook enforcer that prevents delegated transactions from writing
///         to a specific (contract, slot) pair, detected via TXTRACE storage traces.
///
/// Covers: Safe control-plane takeover (protect threshold/guard slots) and proxy
///         implementation swap (protect EIP-1967 slot).
///
/// terms encoding: abi.encode(address protectedContract, bytes32 protectedSlot)
contract SlotProtectionEnforcer is ICaveatEnforcer {
    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    function beforeAllHook(
        bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address
    ) external pure override {}

    function beforeHook(
        bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address
    ) external pure override {}

    function afterHook(
        bytes calldata terms,
        bytes calldata,
        ModeCode,
        bytes calldata,
        bytes32,
        address,
        address
    ) external view override {
        (address protectedContract, bytes32 protectedSlot) =
            abi.decode(terms, (address, bytes32));
        EIP7906ExtendedLibrary.checkSlotProtection(txTraceOracle, protectedContract, protectedSlot);
    }

    function afterAllHook(
        bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address
    ) external pure override {}
}
