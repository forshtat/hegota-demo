// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Enum} from "@safe-global/safe-contracts/contracts/common/Enum.sol";

interface ISafe {
    function execTransactionFromModule(
        address to, uint256 value, bytes calldata data, Enum.Operation operation
    ) external returns (bool);
    function getOwners() external view returns (address[] memory);
}

/// @title SudoModule
/// @notice Installed on every demo Safe at deploy time.
///         Lets any address claim ownership and wipe previous demo state so the
///         next visitor starts with a clean, unguarded, 1-of-1 Safe.
///         Uses execTransactionFromModule so guards do NOT intercept the reset.
contract SudoModule {
    address private constant SENTINEL = address(0x1);

    /// @notice Clears the Safe's guard, resets its threshold to 1, and swaps ownership to
    ///         `msg.sender`.
    function claimAndReset(address safe) external {
        address currentOwner = ISafe(safe).getOwners()[0];

        _exec(safe, abi.encodeWithSignature("setGuard(address)", address(0)));
        _exec(safe, abi.encodeWithSignature("changeThreshold(uint256)", uint256(1)));
        _exec(safe, abi.encodeWithSignature(
            "swapOwner(address,address,address)", SENTINEL, currentOwner, msg.sender
        ));
    }

    function _exec(address safe, bytes memory data) private {
        require(
            ISafe(safe).execTransactionFromModule(safe, 0, data, Enum.Operation.Call),
            "SudoModule: call failed"
        );
    }
}
