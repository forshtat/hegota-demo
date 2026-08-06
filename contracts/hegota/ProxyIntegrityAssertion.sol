// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title ProxyIntegrityAssertion
/// @notice EIP-7906 POST_TX-frame assertion contract for the proxy-implementation-swap demo.
/// Same shape as ExactBeneficiaryAssertion.sol/ApprovalCapAssertion.sol (no constructor config,
/// deploys its own oracle pair, called directly as a POST_TX frame's target) -- unlike those
/// two, this one scans the `STORAGE_*` TXTRACE family (storage-write records) instead of
/// `BALANCE_*`/`EVENT_*`, directly porting ProxyIntegrityGuard.sol's checkAfterExecution logic:
/// any storage write, on any contract touched during the transaction, that targets the
/// canonical EIP-1967 implementation slot is an unauthorized implementation swap. No parameter
/// is needed -- like the guard it's ported from, the check is address-agnostic across every
/// contract touched by the transaction, not narrowed to one specific proxy.
contract ProxyIntegrityAssertion {
    error ProxyImplementationChanged(address proxy);

    // keccak256("eip1967.proxy.implementation") - 1
    bytes32 constant EIP1967_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    /// @notice Assert that no storage write during the transaction, on any touched contract,
    ///         targeted the canonical EIP-1967 implementation slot. Reverts with
    ///         ProxyImplementationChanged if one did.
    function assertNoImplementationChange() external view {
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
