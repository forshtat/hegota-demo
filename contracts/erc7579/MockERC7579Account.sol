// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC7579Hook} from "./IERC7579Hook.sol";

/// @title MockERC7579Account
/// @notice Minimal ERC-7579 account mock for testing hook modules.
///         Orchestrates: preCheck → target call → postCheck.
contract MockERC7579Account {
    error InnerCallFailed();

    /// @param hook  Hook module address. Pass address(0) for the unprotected baseline
    ///              (no pre/post checks; callData is forwarded as-is with no prefix stripping).
    function executeFromExecutor(
        address target,
        bytes calldata callData,
        address hook
    ) external payable {
        if (hook == address(0)) {
            (bool success,) = target.call{value: msg.value}(callData);
            if (!success) revert InnerCallFailed();
            return;
        }

        bytes memory hookData = IERC7579Hook(hook).preCheck(msg.sender, msg.value, callData);

        (bool ok,) = target.call{value: msg.value}(callData[hookData.length:]);
        if (!ok) revert InnerCallFailed();

        IERC7579Hook(hook).postCheck(hookData);
    }
}
