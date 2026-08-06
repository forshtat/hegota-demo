// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC7579Hook} from "./IERC7579Hook.sol";
import {RequiredEventHook} from "../erc6900/RequiredEventHook.sol";

/// @title TxTraceValidator
/// @notice ERC-7579 type-4 hook module that applies the same RequiredEventHook
///         assertion logic through the ERC-7579 preCheck / postCheck interface.
///
/// This demonstrates ERC-4337 / EIP-8141 and ERC-7579 sharing identical TXTRACE
/// assertion contracts despite different account interfaces.
contract TxTraceValidator is IERC7579Hook, RequiredEventHook {
    constructor() RequiredEventHook() {}

    function preCheck(
        address,
        uint256,
        bytes calldata msgData
    ) external pure override returns (bytes memory hookData) {
        return msgData[:64];
    }

    function postCheck(bytes calldata hookData) external view override {
        (bytes32 requiredTopic0, uint256 requiredAmount) =
            abi.decode(hookData, (bytes32, uint256));
        _assertRequiredEvent(requiredTopic0, requiredAmount);
    }

    function preExecutionHook(uint32, address, uint256, bytes calldata data)
        external pure override returns (bytes memory) {
        return data[:64];
    }

    function postExecutionHook(uint32, bytes calldata preExecHookData)
        external view override {
        (bytes32 topic0, uint256 amount) = abi.decode(preExecHookData, (bytes32, uint256));
        _assertRequiredEvent(topic0, amount);
    }
}
