// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseGuard} from "@safe-global/safe-contracts/contracts/base/GuardManager.sol";
import {Enum} from "@safe-global/safe-contracts/contracts/common/Enum.sol";
import {EIP7906ExtendedLibrary} from "../shared/EIP7906ExtendedLibrary.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title MinOutputGuard
/// @notice Gnosis Safe guard that asserts a minimum ERC-20 token output was received
///         within the transaction via TXTRACE.
/// Mirrors MinOutputHook for the Safe framework.
///
/// The token, recipient, and minimum amount are fixed at construction time.
contract MinOutputGuard is BaseGuard {
    address public immutable txTraceOracle;
    address public immutable eventDataOracle;
    address public immutable token;
    address public immutable recipient;
    uint256 public immutable minAmount;

    constructor(
        address _token,
        address _recipient,
        uint256 _minAmount
    ) {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
        token           = _token;
        recipient       = _recipient;
        minAmount       = _minAmount;
    }

    function checkTransaction(
        address, uint256, bytes memory, Enum.Operation,
        uint256, uint256, uint256, address, address payable, bytes memory, address
    ) external pure override {}

    function checkAfterExecution(bytes32, bool) external view override {
        EIP7906ExtendedLibrary.checkMinOutput(txTraceOracle, eventDataOracle, token, recipient, minAmount);
    }
}
