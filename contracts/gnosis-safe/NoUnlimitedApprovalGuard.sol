// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseGuard} from "@safe-global/safe-contracts/contracts/base/GuardManager.sol";
import {Enum} from "@safe-global/safe-contracts/contracts/common/Enum.sol";
import {EIP7906ExtendedLibrary} from "../shared/EIP7906ExtendedLibrary.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title NoUnlimitedApprovalGuard
/// @notice Gnosis Safe guard that detects unlimited ERC-20 approvals via TXTRACE.
/// Mirrors the detection logic of NoUnlimitedApprovalEnforcer for the Safe framework.
///
/// Constructor parameter _maxApproval configures the threshold; any Approval event
/// exceeding it will revert the transaction.
contract NoUnlimitedApprovalGuard is BaseGuard {
    address public immutable txTraceOracle;
    address public immutable eventDataOracle;
    uint256 public immutable maxApproval;

    constructor(uint256 _maxApproval) {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
        maxApproval = _maxApproval;
    }

    function checkTransaction(
        address, uint256, bytes memory, Enum.Operation,
        uint256, uint256, uint256, address, address payable, bytes memory, address
    ) external pure override {}

    function checkAfterExecution(bytes32, bool) external view override {
        EIP7906ExtendedLibrary.checkNoUnlimitedApproval(txTraceOracle, eventDataOracle, maxApproval);
    }
}
