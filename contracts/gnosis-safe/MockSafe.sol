// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Guard} from "@safe-global/safe-contracts/contracts/base/GuardManager.sol";
import {Enum} from "@safe-global/safe-contracts/contracts/common/Enum.sol";

/// @title MockSafe
/// @notice Minimal Gnosis Safe mock for testing transaction guards.
///         Orchestrates: checkTransaction → target call → checkAfterExecution.
///         setGuard enforces the real Safe GS300 supportsInterface check.
contract MockSafe {
    error InnerCallFailed();

    address public guard;     // slot 0
    uint256 public threshold; // slot 1 — protected by SafeIntegrityGuard

    function changeThreshold(uint256 _threshold) external {
        threshold = _threshold;
    }

    function setGuard(address _guard) external {
        if (_guard != address(0)) {
            require(
                Guard(_guard).supportsInterface(type(Guard).interfaceId),
                "GS300"
            );
        }
        guard = _guard;
    }

    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data
    ) external payable {
        bytes32 txHash = keccak256(abi.encode(to, value, data));

        if (guard != address(0)) {
            Guard(guard).checkTransaction(
                to,
                value,
                data,
                Enum.Operation.Call,
                0,           // safeTxGas
                0,           // baseGas
                0,           // gasPrice
                address(0),  // gasToken
                payable(address(0)), // refundReceiver
                "",          // signatures
                msg.sender
            );
        }

        (bool ok,) = to.call{value: value}(data);
        if (!ok) revert InnerCallFailed();

        if (guard != address(0)) {
            Guard(guard).checkAfterExecution(txHash, ok);
        }
    }
}
