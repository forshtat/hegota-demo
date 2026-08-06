// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TxTraceLib} from "../shared/TxTraceLib.sol";
import {ConstraintType, Constraint} from "./MinOutputAssertion.sol";

// keccak256("Approval(address,address,uint256)")
bytes32 constant ERC20_APPROVAL_TOPIC = 0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925;

/// @title ApprovalCapAssertion
/// @notice EIP-7906 POST_TX-frame assertion contract for the unlimited-approval demo. Same
/// shape as MinOutputAssertion.sol/RequiredEventAssertion.sol (no constructor config, deploys
/// its own oracle pair, called directly as a POST_TX frame's target). Scans TXTRACE for an
/// `Approval(address owner, address spender, uint256 value)` event emitted by `token` to
/// `spender` and reverts if its value fails `capConstraint` (typically an LTE cap) --
/// structurally almost identical to MinOutputAssertion, just filtering on the Approval topic
/// and matching `spender` (topic2) instead of Transfer's recipient.
contract ApprovalCapAssertion {
    error NoMatchingApproval(address token, address spender);
    error ConstraintViolated(uint256 actual, ConstraintType constraintType, bytes referenceData);

    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    /// @notice Assert that the transaction emitted an Approval(_, spender, value) event from
    ///         `token` whose value satisfies `capConstraint`. Reverts otherwise.
    function assertApprovalCap(
        address token,
        address spender,
        Constraint calldata capConstraint
    ) external view {
        uint256 n = TxTraceLib.query(txTraceOracle, TxTraceLib.EVENT_COUNT, 0);

        for (uint256 i = 0; i < n; i++) {
            address emitter = address(uint160(TxTraceLib.query(txTraceOracle, TxTraceLib.EVENT_ADDRESS, i)));
            if (emitter != token) continue;

            bytes32 topic0 = bytes32(TxTraceLib.query(txTraceOracle, TxTraceLib.EVENT_TOPIC0, i));
            if (topic0 != ERC20_APPROVAL_TOPIC) continue;

            uint256 spenderRaw = TxTraceLib.query(txTraceOracle, TxTraceLib.EVENT_TOPIC2, i);
            if (address(uint160(spenderRaw)) != spender) continue;

            uint256 dataLen = TxTraceLib.query(txTraceOracle, TxTraceLib.EVENT_DATA_LEN, i);
            if (dataLen < 32) continue;

            bytes memory raw = TxTraceLib.getEventData(eventDataOracle, i, 0, 32);
            uint256 amount;
            assembly {
                amount := mload(add(raw, 0x20))
            }

            _requireConstraint(amount, capConstraint);
            return;
        }

        revert NoMatchingApproval(token, spender);
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
