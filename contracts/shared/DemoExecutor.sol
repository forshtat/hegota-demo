// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Enum} from "@safe-global/safe-contracts/contracts/common/Enum.sol";

interface ISafe {
    function execTransaction(
        address to, uint256 value, bytes calldata data,
        Enum.Operation operation,
        uint256 safeTxGas, uint256 baseGas, uint256 gasPrice,
        address gasToken, address payable refundReceiver,
        bytes memory signatures
    ) external payable returns (bool);
}

/// @title DemoExecutor
/// @notice Bootstrap owner for the demo Safes.
///         Deploy each Safe with this contract as the sole owner (threshold=1).
///         Anyone can call execute() to push one transaction through the Safe —
///         intended only for the initial swapOwner() that hands control to the
///         connected MetaMask wallet. After that the Safe behaves like a normal
///         1-of-1 EOA-owned multisig.
contract DemoExecutor {
    /// @param safe   The Safe to execute through.
    /// @param to     Transaction target.
    /// @param value  ETH value.
    /// @param data   Calldata.
    function execute(
        address safe,
        address to,
        uint256 value,
        bytes calldata data
    ) external payable {
        // v=1 approved-hash signature: the Safe checks msg.sender == r == owner.
        // Since this contract IS the sole owner and IS msg.sender, it passes.
        bytes memory sig = abi.encodePacked(
            bytes32(uint256(uint160(address(this)))), // r: this contract (the owner)
            bytes32(0),                               // s: unused
            uint8(1)                                  // v: approved-hash
        );

        ISafe(safe).execTransaction{value: value}(
            to, value, data, Enum.Operation.Call,
            0, 0, 0, address(0), payable(address(0)),
            sig
        );
    }
}
