// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC6900ExecutionHookModule} from "./IERC6900Hooks.sol";
import {EIP7906ExtendedLibrary} from "../shared/EIP7906ExtendedLibrary.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title MinOutputHook
/// @notice ERC-6900 post-execution hook that asserts a minimum ERC-20 token output was
///         received by a specific address within the transaction.
///
/// Covers two threat classes:
///   - MEV sandwich: attacker front/back-runs a swap, reducing the output below the
///     user's acceptable minimum.
///   - Oracle TOCTOU: oracle price is manipulated between simulation and inclusion,
///     causing execution at a worse price than expected.
///
/// Both manifest identically: the output token Transfer to the recipient is below minAmount.
///
/// hookData (96 bytes): abi.encode(address token, address recipient, uint256 minAmount)
contract MinOutputHook is IERC6900ExecutionHookModule {
    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    function preExecutionHook(
        uint32,
        address,
        uint256,
        bytes calldata data
    ) external pure override returns (bytes memory hookData) {
        return data[:96];
    }

    function postExecutionHook(uint32, bytes calldata preExecHookData) external view override {
        (address token, address recipient, uint256 minAmount) =
            abi.decode(preExecHookData, (address, address, uint256));
        EIP7906ExtendedLibrary.checkMinOutput(txTraceOracle, eventDataOracle, token, recipient, minAmount);
    }
}
