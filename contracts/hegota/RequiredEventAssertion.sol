// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title RequiredEventAssertion
/// @notice EIP-7906 POST_TX-frame assertion contract for the Hegotá devnet demo.
///
/// Unlike the ERC-6900/ERC-7579/Gnosis Safe/MetaMask policy contracts elsewhere in this
/// repo (which call TXTRACE/EVENTDATACOPY mid-call from an ordinary hook invoked during a
/// normal transaction), this contract is meant to be called directly as the `target` of a
/// POST_TX frame (mode 3) in an EIP-8141 type-0x06 frame transaction. On the integrated
/// Hegotá devnet, TXTRACE/EVENTDATACOPY/TXDIFF exceptional-halt outside a POST_TX frame's
/// call subtree, so this assertion only functions when invoked that way.
///
/// Logic mirrors RequiredEventHook._assertRequiredEvent (contracts/erc6900/RequiredEventHook.sol):
/// walk TXTRACE events for one whose topic0 matches `requiredTopic0` and whose first 32
/// bytes of data equal `requiredAmount`; revert if none match. A POST_TX frame's revert
/// invalidates the whole transaction (it is excluded from the block, not merely reverted).
contract RequiredEventAssertion {
    error RequiredEventNotFound(bytes32 requiredTopic0, uint256 requiredAmount);

    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    /// @notice Assert that the transaction emitted an event with topic0 == requiredTopic0
    ///         whose first 32 bytes of data == requiredAmount. Reverts otherwise.
    function assertRequiredEvent(bytes32 requiredTopic0, uint256 requiredAmount) external view {
        uint256 n = TxTraceLib.query(txTraceOracle, TxTraceLib.EVENT_COUNT, 0);

        for (uint256 i = 0; i < n; i++) {
            bytes32 topic0 = bytes32(TxTraceLib.query(txTraceOracle, TxTraceLib.EVENT_TOPIC0, i));
            if (topic0 != requiredTopic0) continue;

            uint256 dataLen = TxTraceLib.query(txTraceOracle, TxTraceLib.EVENT_DATA_LEN, i);
            if (dataLen < 32) continue;

            bytes memory raw = TxTraceLib.getEventData(eventDataOracle, i, 0, 32);
            uint256 amount;
            assembly { amount := mload(add(raw, 0x20)) }

            if (amount == requiredAmount) return;
        }

        revert RequiredEventNotFound(requiredTopic0, requiredAmount);
    }
}
