// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MockProxy
/// @notice Minimal EIP-1967 transparent proxy skeleton for testing ProxyIntegrityGuard.
///         Stores implementation address at the canonical EIP-1967 slot.
contract MockProxy {
    // keccak256("eip1967.proxy.implementation") - 1
    bytes32 constant EIP1967_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address _implementation) {
        assembly { sstore(EIP1967_SLOT, _implementation) }
    }

    function implementation() external view returns (address impl) {
        assembly { impl := sload(EIP1967_SLOT) }
    }

    function setImplementation(address _impl) external {
        assembly { sstore(EIP1967_SLOT, _impl) }
    }
}
