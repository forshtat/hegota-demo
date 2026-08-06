// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC6900ExecutionHookModule} from "./IERC6900Hooks.sol";
import {EIP7906ExtendedLibrary} from "../shared/EIP7906ExtendedLibrary.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title ExactBeneficiaryHook
/// @notice ERC-6900 post-execution hook that detects hidden ETH drains via TXTRACE.
/// Mirrors the detection logic of the ERC-7579 ExactBeneficiaryHook for the ERC-6900 framework.
///
/// hookData (32 bytes): abi.encode(address allowedRecipient) — first 32 bytes of callData
contract ExactBeneficiaryHook is IERC6900ExecutionHookModule {
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
        address allowedRecipient = abi.decode(preExecHookData, (address));
        EIP7906ExtendedLibrary.checkExactBeneficiary(txTraceOracle, allowedRecipient);
    }
}
