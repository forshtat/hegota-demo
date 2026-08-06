// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC6900ExecutionHookModule} from "./IERC6900Hooks.sol";
import {EIP7906ExtendedLibrary} from "../shared/EIP7906ExtendedLibrary.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title NoUnlimitedApprovalHook
/// @notice ERC-6900 post-execution hook that detects unlimited ERC-20 approvals via TXTRACE.
/// Mirrors the detection logic of NoUnlimitedApprovalEnforcer for the ERC-6900 framework.
///
/// hookData (32 bytes): abi.encode(uint256 maxAllowableApproval) — first 32 bytes of callData
contract NoUnlimitedApprovalHook is IERC6900ExecutionHookModule {
    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    function preExecutionHook(uint32, address, uint256, bytes calldata data)
        external pure override returns (bytes memory hookData)
    {
        return data[:32];
    }

    function postExecutionHook(uint32, bytes calldata preExecHookData) external view override {
        uint256 maxAllowableApproval = abi.decode(preExecHookData, (uint256));
        EIP7906ExtendedLibrary.checkNoUnlimitedApproval(txTraceOracle, eventDataOracle, maxAllowableApproval);
    }
}
