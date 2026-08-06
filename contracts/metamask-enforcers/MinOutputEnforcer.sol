// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ICaveatEnforcer} from "@metamask/delegation-framework/interfaces/ICaveatEnforcer.sol";
import {ModeCode} from "@erc7579/lib/ModeLib.sol";
import {EIP7906ExtendedLibrary} from "../shared/EIP7906ExtendedLibrary.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title MinOutputEnforcer
/// @notice ERC-7710 afterHook enforcer that asserts a minimum ERC-20 token output
///         was received within the delegated transaction via TXTRACE.
/// Mirrors MinOutputHook for the MetaMask delegation framework.
///
/// terms encoding: abi.encode(address token, address recipient, uint256 minAmount)
contract MinOutputEnforcer is ICaveatEnforcer {
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
        (address token, address recipient, uint256 minAmount) =
            abi.decode(terms, (address, address, uint256));
        EIP7906ExtendedLibrary.checkMinOutput(txTraceOracle, eventDataOracle, token, recipient, minAmount);
    }

    function afterAllHook(
        bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address
    ) external pure override {}
}
