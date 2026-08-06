// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal ERC-7579 type-4 hook module interface.
/// Full spec: https://eips.ethereum.org/EIPS/eip-7579
interface IERC7579Hook {
    /// @notice Called before execution. Return value forwarded to postCheck.
    function preCheck(
        address msgSender,
        uint256 value,
        bytes calldata msgData
    ) external returns (bytes memory hookData);

    /// @notice Called after execution. Revert here rolls back the transaction.
    function postCheck(bytes calldata hookData) external;
}
