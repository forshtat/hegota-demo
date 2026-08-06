// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ICaveatEnforcer} from "@metamask/delegation-framework/interfaces/ICaveatEnforcer.sol";
import {ModeCode} from "@erc7579/lib/ModeLib.sol";
import {EIP7906ExtendedLibrary} from "../shared/EIP7906ExtendedLibrary.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title ExactBeneficiaryEnforcer
/// @notice ERC-7710 afterHook enforcer that detects hidden ETH drains via TXTRACE.
/// Mirrors the detection logic of ExactBeneficiaryHook for the MetaMask delegation framework.
///
/// terms encoding: abi.encode(address allowedRecipient)
contract ExactBeneficiaryEnforcer is ICaveatEnforcer {
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
        address allowedRecipient = abi.decode(terms, (address));
        EIP7906ExtendedLibrary.checkExactBeneficiary(txTraceOracle, allowedRecipient);
    }

    function afterAllHook(
        bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address
    ) external pure override {}
}
