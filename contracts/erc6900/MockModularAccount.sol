// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC6900ExecutionHookModule} from "./IERC6900Hooks.sol";

/// @title MockModularAccount
/// @notice Minimal ERC-6900 modular account mock for testing execution hooks.
///         Orchestrates: preExecutionHook → target call → postExecutionHook.
contract MockModularAccount {
    error InnerCallFailed();

    /// @param target    Contract to execute.
    /// @param callData  Encoded call to forward.
    /// @param hook      IERC6900ExecutionHookModule to apply. Pass address(0) for the
    ///                  unprotected baseline (no pre/post hooks; callData is forwarded
    ///                  as-is with no prefix stripping).
    /// @param entityId  Hook entity identifier.
    function executeWithHook(
        address target,
        bytes calldata callData,
        address hook,
        uint32 entityId
    ) external payable {
        if (hook == address(0)) {
            (bool success,) = target.call{value: msg.value}(callData);
            if (!success) revert InnerCallFailed();
            return;
        }

        bytes memory hookData = IERC6900ExecutionHookModule(hook).preExecutionHook(
            entityId,
            msg.sender,
            msg.value,
            callData
        );

        (bool ok,) = target.call{value: msg.value}(callData[hookData.length:]);
        if (!ok) revert InnerCallFailed();

        IERC6900ExecutionHookModule(hook).postExecutionHook(entityId, hookData);
    }
}
