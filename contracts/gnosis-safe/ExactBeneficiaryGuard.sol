// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseGuard} from "@safe-global/safe-contracts/contracts/base/GuardManager.sol";
import {Enum} from "@safe-global/safe-contracts/contracts/common/Enum.sol";
import {EIP7906ExtendedLibrary} from "../shared/EIP7906ExtendedLibrary.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title ExactBeneficiaryGuard
/// @notice Gnosis Safe guard that detects hidden ETH drains via TXTRACE.
/// Mirrors the detection logic of ExactBeneficiaryHook for the Safe framework.
///
/// The allowed recipient is fixed at construction time.
contract ExactBeneficiaryGuard is BaseGuard {
    address public immutable txTraceOracle;
    address public immutable eventDataOracle;
    address public immutable allowedRecipient;

    constructor(address _allowedRecipient) {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
        allowedRecipient  = _allowedRecipient;
    }

    function checkTransaction(
        address, uint256, bytes memory, Enum.Operation,
        uint256, uint256, uint256, address, address payable, bytes memory, address
    ) external pure override {}

    function checkAfterExecution(bytes32, bool) external view override {
        EIP7906ExtendedLibrary.checkExactBeneficiary(txTraceOracle, allowedRecipient);
    }
}
