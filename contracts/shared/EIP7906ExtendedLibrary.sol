// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TxTraceLib} from "./TxTraceLib.sol";

/// @title EIP7906ExtendedLibrary
/// @notice Shared policy-check functions built on TxTraceLib, used by the ERC-7579, ERC-6900,
///         MetaMask enforcer, and Gnosis Safe adapters.
library EIP7906ExtendedLibrary {
    // keccak256("Approval(address,address,uint256)")
    bytes32 internal constant APPROVAL_TOPIC =
        0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925;

    // keccak256("Transfer(address,address,uint256)")
    bytes32 internal constant ERC20_TRANSFER_TOPIC =
        0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;

    error UnlimitedApprovalDetected(uint256 actual, uint256 max);
    error InsufficientOutput(uint256 actual, uint256 minimum);
    error UnexpectedRecipient(address addr);
    error ProtectedSlotModified(address target, bytes32 slot);

    /// @notice Reverts if any ERC-20 Approval event in the current transaction carries an
    ///         amount exceeding `max`.
    function checkNoUnlimitedApproval(
        address txOracle,
        address evOracle,
        uint256 max
    ) internal view {
        uint256 n = TxTraceLib.query(txOracle, TxTraceLib.EVENT_COUNT, 0);
        for (uint256 i = 0; i < n; i++) {
            bytes32 topic0 = bytes32(TxTraceLib.query(txOracle, TxTraceLib.EVENT_TOPIC0, i));
            if (topic0 != APPROVAL_TOPIC) continue;

            uint256 dataLen = TxTraceLib.query(txOracle, TxTraceLib.EVENT_DATA_LEN, i);
            if (dataLen < 32) continue;

            bytes memory raw = TxTraceLib.getEventData(evOracle, i, 0, 32);
            uint256 amount;
            assembly { amount := mload(add(raw, 0x20)) }

            if (amount > max) revert UnlimitedApprovalDetected(amount, max);
        }
    }

    /// @notice Reverts if no Transfer event from `token` to `recipient` carries at least
    ///         `minAmount`, guarding against MEV sandwich and oracle TOCTOU attacks.
    function checkMinOutput(
        address txOracle,
        address evOracle,
        address token,
        address recipient,
        uint256 minAmount
    ) internal view {
        uint256 n = TxTraceLib.query(txOracle, TxTraceLib.EVENT_COUNT, 0);
        for (uint256 i = 0; i < n; i++) {
            address emitter = address(uint160(
                TxTraceLib.query(txOracle, TxTraceLib.EVENT_ADDRESS, i)
            ));
            if (emitter != token) continue;

            bytes32 topic0 = bytes32(TxTraceLib.query(txOracle, TxTraceLib.EVENT_TOPIC0, i));
            if (topic0 != ERC20_TRANSFER_TOPIC) continue;

            uint256 toRaw = TxTraceLib.query(txOracle, TxTraceLib.EVENT_TOPIC2, i);
            if (address(uint160(toRaw)) != recipient) continue;

            uint256 dataLen = TxTraceLib.query(txOracle, TxTraceLib.EVENT_DATA_LEN, i);
            if (dataLen < 32) continue;

            bytes memory raw = TxTraceLib.getEventData(evOracle, i, 0, 32);
            uint256 amount;
            assembly { amount := mload(add(raw, 0x20)) }

            if (amount >= minAmount) return;
            revert InsufficientOutput(amount, minAmount);
        }

        revert InsufficientOutput(0, minAmount);
    }

    /// @notice Reverts if any ETH balance increase occurs at an address other than
    ///         `allowedRecipient`, detecting hidden ETH drains in multicall patterns.
    function checkExactBeneficiary(
        address txOracle,
        address allowedRecipient
    ) internal view {
        uint256 n = TxTraceLib.query(txOracle, TxTraceLib.BALANCE_COUNT, 0);
        for (uint256 i = 0; i < n; i++) {
            uint256 balBefore = TxTraceLib.query(txOracle, TxTraceLib.BALANCE_BEFORE, i);
            uint256 balAfter  = TxTraceLib.query(txOracle, TxTraceLib.BALANCE_AFTER,  i);
            if (balAfter <= balBefore) continue;

            address addr = address(uint160(
                TxTraceLib.query(txOracle, TxTraceLib.BALANCE_ADDRESS, i)
            ));
            if (addr != allowedRecipient) revert UnexpectedRecipient(addr);
        }
    }

    /// @notice Reverts if `protectedSlot` was written on `protectedContract` during the
    ///         transaction, preventing control-plane takeover and proxy swaps.
    function checkSlotProtection(
        address txOracle,
        address protectedContract,
        bytes32 protectedSlot
    ) internal view {
        uint256 n = TxTraceLib.query(txOracle, TxTraceLib.STORAGE_COUNT, 0);
        for (uint256 i = 0; i < n; i++) {
            bytes32 slot = bytes32(TxTraceLib.query(txOracle, TxTraceLib.STORAGE_SLOT, i));
            if (slot != protectedSlot) continue;

            address contractAddr = address(uint160(
                TxTraceLib.query(txOracle, TxTraceLib.STORAGE_ADDRESS, i)
            ));
            if (contractAddr == protectedContract) revert ProtectedSlotModified(contractAddr, slot);
        }
    }
}
