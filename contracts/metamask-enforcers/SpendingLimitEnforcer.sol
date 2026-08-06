// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ICaveatEnforcer} from "@metamask/delegation-framework/interfaces/ICaveatEnforcer.sol";
import {ModeCode} from "@erc7579/lib/ModeLib.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title SpendingLimitEnforcer
/// @notice ERC-7710 afterHook enforcer that uses TXTRACE to limit how much native ETH
///         a delegated call may spend from a watched address.
///
/// terms encoding: abi.encode(address watchedAddress, uint256 maxSpend)
///
/// In afterHook we iterate over all TXTRACE balance changes. If the watched address
/// shows a net decrease greater than maxSpend we revert the entire delegated call.
contract SpendingLimitEnforcer is ICaveatEnforcer {
    error SpendingLimitExceeded(uint256 actual, uint256 limit);

    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    function beforeAllHook(
        bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address
    ) external pure override {}

    function beforeHook(
        bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address
    ) external pure override {}

    function afterHook(
        bytes calldata terms,
        bytes calldata,
        ModeCode,
        bytes calldata,
        bytes32,
        address,
        address
    ) external view override {
        (address watchedAddress, uint256 maxSpend) = abi.decode(terms, (address, uint256));

        uint256 n = TxTraceLib.query(txTraceOracle, TxTraceLib.BALANCE_COUNT, 0);
        for (uint256 i = 0; i < n; i++) {
            address addr = address(uint160(TxTraceLib.query(txTraceOracle, TxTraceLib.BALANCE_ADDRESS, i)));
            if (addr != watchedAddress) continue;

            uint256 balBefore = TxTraceLib.query(txTraceOracle, TxTraceLib.BALANCE_BEFORE, i);
            uint256 balAfter  = TxTraceLib.query(txTraceOracle, TxTraceLib.BALANCE_AFTER,  i);

            if (balBefore > balAfter) {
                uint256 decrease = balBefore - balAfter;
                if (decrease > maxSpend) {
                    revert SpendingLimitExceeded(decrease, maxSpend);
                }
            }
            return;
        }
    }

    function afterAllHook(
        bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address
    ) external pure override {}
}
