// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC7579Hook} from "./IERC7579Hook.sol";
import {EIP7906ExtendedLibrary} from "../shared/EIP7906ExtendedLibrary.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title NoUnlimitedApprovalHook
/// @notice ERC-7579 hook that detects unlimited ERC-20 approvals via TXTRACE.
/// Mirrors the detection logic of NoUnlimitedApprovalEnforcer for the ERC-7579 framework.
///
/// hookData (32 bytes): abi.encode(uint256 maxAllowableApproval) — first 32 bytes of msgData
contract NoUnlimitedApprovalHook is IERC7579Hook {
    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    function preCheck(address, uint256, bytes calldata msgData)
        external pure override returns (bytes memory hookData)
    {
        return msgData[:32];
    }

    function postCheck(bytes calldata hookData) external view override {
        uint256 maxAllowableApproval = abi.decode(hookData, (uint256));
        EIP7906ExtendedLibrary.checkNoUnlimitedApproval(txTraceOracle, eventDataOracle, maxAllowableApproval);
    }
}
