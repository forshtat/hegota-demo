// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseGuard} from "@safe-global/safe-contracts/contracts/base/GuardManager.sol";
import {Enum} from "@safe-global/safe-contracts/contracts/common/Enum.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title ProxyIntegrityGuard
/// @notice Gnosis Safe guard that detects writes to the EIP-1967 implementation slot,
///         preventing proxy implementation swaps during a transaction.
///
/// Threat: between simulation time and execution, a proxy's implementation is swapped
///         to a malicious contract. Or a tx secretly upgrades a proxy mid-execution.
///
/// Detection: scan TXTRACE storage changes; if any write targets the canonical EIP-1967
///            implementation slot on any contract → revert.
contract ProxyIntegrityGuard is BaseGuard {
    error ProxyImplementationChanged(address proxy);

    // keccak256("eip1967.proxy.implementation") - 1
    bytes32 constant EIP1967_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

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
        uint256 n = TxTraceLib.query(txTraceOracle, TxTraceLib.STORAGE_COUNT, 0);
        for (uint256 i = 0; i < n; i++) {
            bytes32 slot = bytes32(TxTraceLib.query(txTraceOracle, TxTraceLib.STORAGE_SLOT, i));
            if (slot == EIP1967_SLOT) {
                address proxy = address(uint160(
                    TxTraceLib.query(txTraceOracle, TxTraceLib.STORAGE_ADDRESS, i)
                ));
                revert ProxyImplementationChanged(proxy);
            }
        }
    }
}
