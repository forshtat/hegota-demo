// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal ERC-6900 execution hook module interface.
/// Full spec: https://eips.ethereum.org/EIPS/eip-6900
interface IERC6900ExecutionHookModule {
    /// @notice Called before execution. May return arbitrary hook data passed to postExecutionHook.
    /// @param entityId   Module-internal identifier for the hook instance.
    /// @param sender     Original msg.sender of the account call.
    /// @param value      Native ETH value in the call.
    /// @param data       Encoded call data.
    /// @return hookData  Context bytes forwarded to postExecutionHook.
    function preExecutionHook(
        uint32 entityId,
        address sender,
        uint256 value,
        bytes calldata data
    ) external returns (bytes memory hookData);

    /// @notice Called after execution. Revert here rolls back the entire transaction.
    /// @param entityId       Module-internal identifier (matches the pre-hook call).
    /// @param preExecHookData  Data returned by the corresponding preExecutionHook.
    function postExecutionHook(uint32 entityId, bytes calldata preExecHookData) external;
}
