// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC6900ExecutionHookModule} from "./IERC6900Hooks.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title RequiredEventHook
/// @notice ERC-6900 post-execution hook that uses TXTRACE + EVENTDATACOPY to assert
///         that a specific event was emitted by the execution with the correct data.
///
/// hookData (returned by preExecutionHook, forwarded to postExecutionHook):
///   abi.encode(bytes32 requiredTopic0, uint256 requiredAmount)
///
/// In postExecutionHook we:
///   1. Count TXTRACE events.
///   2. For each event whose topic0 matches requiredTopic0:
///      a. Check EVENT_DATA_LEN >= 32.
///      b. Use the EventData oracle (EVENTDATACOPY internally) to get first 32 bytes.
///      c. Decode as uint256 and compare with requiredAmount.
///      d. If matches → success (return).
///   3. If no matching event found → revert.
///
/// Shared assertion logic is in _assertRequiredEvent(), which TxTraceValidator also uses.
contract RequiredEventHook is IERC6900ExecutionHookModule {
    error RequiredEventNotFound(bytes32 requiredTopic0, uint256 requiredAmount);

    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    function preExecutionHook(
        uint32,
        address,
        uint256,
        bytes calldata data
    ) external pure virtual override returns (bytes memory hookData) {
        // First 64 bytes of calldata encode (bytes32 topic0, uint256 amount)
        return data[:64];
    }

    function postExecutionHook(uint32, bytes calldata preExecHookData) external view virtual override {
        (bytes32 requiredTopic0, uint256 requiredAmount) =
            abi.decode(preExecHookData, (bytes32, uint256));
        _assertRequiredEvent(requiredTopic0, requiredAmount);
    }

    /// @dev Shared assertion: walk TXTRACE events looking for requiredTopic0 with
    ///      the correct first 32 bytes of event data (= requiredAmount).
    function _assertRequiredEvent(bytes32 requiredTopic0, uint256 requiredAmount) internal view {
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
