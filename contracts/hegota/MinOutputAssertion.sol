// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TxTraceLib} from "../shared/TxTraceLib.sol";

// keccak256("Transfer(address,address,uint256)")
bytes32 constant ERC20_TRANSFER_TOPIC = 0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef;

/// @notice A comparator predicate on a resolved uint256 value, using the same shape as
/// ERC-8211 (Smart Batching)'s `Constraint` -- a genuinely reusable, tiny vocabulary
/// (confirmed by reading its spec directly), adopted here without the rest of that ERC's
/// batching/staticcall-resolution machinery, which solves a different (pre-execution)
/// problem than what this contract checks (a real post-execution outcome).
enum ConstraintType {
    EQ,
    GTE,
    LTE,
    IN
}

struct Constraint {
    ConstraintType constraintType;
    bytes referenceData;
}

/// @title MinOutputAssertion
/// @notice EIP-7906 POST_TX-frame assertion contract for the anti-sandwich / oracle-TOCTOU
/// demo. Same shape as RequiredEventAssertion.sol (no constructor config, deploys its own
/// oracle pair, called directly as a POST_TX frame's target) -- structurally almost
/// identical to it, just with a general comparator instead of exact equality, and an
/// emitter+recipient filter, mirroring EIP7906ExtendedLibrary.checkMinOutput's proven logic.
contract MinOutputAssertion {
    error NoMatchingTransfer(address token, address recipient);
    error ConstraintViolated(uint256 actual, ConstraintType constraintType, bytes referenceData);

    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    /// @notice Assert that the transaction emitted a Transfer(_, recipient, amount) event
    ///         from `token` whose amount satisfies `outputConstraint`. Reverts otherwise.
    function assertMinOutput(
        address token,
        address recipient,
        Constraint calldata outputConstraint
    ) external view {
        uint256 n = TxTraceLib.query(txTraceOracle, TxTraceLib.EVENT_COUNT, 0);

        for (uint256 i = 0; i < n; i++) {
            address emitter = address(uint160(TxTraceLib.query(txTraceOracle, TxTraceLib.EVENT_ADDRESS, i)));
            if (emitter != token) continue;

            bytes32 topic0 = bytes32(TxTraceLib.query(txTraceOracle, TxTraceLib.EVENT_TOPIC0, i));
            if (topic0 != ERC20_TRANSFER_TOPIC) continue;

            uint256 toRaw = TxTraceLib.query(txTraceOracle, TxTraceLib.EVENT_TOPIC2, i);
            if (address(uint160(toRaw)) != recipient) continue;

            uint256 dataLen = TxTraceLib.query(txTraceOracle, TxTraceLib.EVENT_DATA_LEN, i);
            if (dataLen < 32) continue;

            bytes memory raw = TxTraceLib.getEventData(eventDataOracle, i, 0, 32);
            uint256 amount;
            assembly {
                amount := mload(add(raw, 0x20))
            }

            _requireConstraint(amount, outputConstraint);
            return;
        }

        revert NoMatchingTransfer(token, recipient);
    }

    function _requireConstraint(uint256 value, Constraint calldata c) private pure {
        if (c.constraintType == ConstraintType.EQ) {
            if (value != uint256(bytes32(c.referenceData))) {
                revert ConstraintViolated(value, c.constraintType, c.referenceData);
            }
        } else if (c.constraintType == ConstraintType.GTE) {
            if (value < uint256(bytes32(c.referenceData))) {
                revert ConstraintViolated(value, c.constraintType, c.referenceData);
            }
        } else if (c.constraintType == ConstraintType.LTE) {
            if (value > uint256(bytes32(c.referenceData))) {
                revert ConstraintViolated(value, c.constraintType, c.referenceData);
            }
        } else {
            (bytes32 lowerBound, bytes32 upperBound) = abi.decode(c.referenceData, (bytes32, bytes32));
            if (value < uint256(lowerBound) || value > uint256(upperBound)) {
                revert ConstraintViolated(value, c.constraintType, c.referenceData);
            }
        }
    }
}
