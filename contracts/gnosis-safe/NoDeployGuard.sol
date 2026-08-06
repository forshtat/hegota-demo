// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseGuard} from "@safe-global/safe-contracts/contracts/base/GuardManager.sol";
import {Enum} from "@safe-global/safe-contracts/contracts/common/Enum.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title NoDeployGuard
/// @notice Gnosis Safe guard that uses TXTRACE to prevent any transaction from
///         deploying new contracts.
contract NoDeployGuard is BaseGuard {
    error UnauthorizedContractDeployment(address deployed);

    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    function checkTransaction(
        address, uint256, bytes memory, Enum.Operation,
        uint256, uint256, uint256, address, address payable, bytes memory, address
    ) external pure override {}

    function checkAfterExecution(bytes32, bool) external view override {
        uint256 n = TxTraceLib.query(txTraceOracle, TxTraceLib.CONTRACT_COUNT, 0);
        if (n > 0) {
            address deployed = address(uint160(
                TxTraceLib.query(txTraceOracle, TxTraceLib.CONTRACT_ADDR, 0)
            ));
            revert UnauthorizedContractDeployment(deployed);
        }
    }
}
