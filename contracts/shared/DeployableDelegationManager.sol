// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity 0.8.23;

import { DelegationManager } from "@metamask/delegation-framework/DelegationManager.sol";

/// @dev Thin wrapper so Hardhat compiles the real MetaMask DelegationManager and places
///      its artifact under artifacts/contracts/ where demo.mjs and abis.ts can import it.
///      The constructor is identical to DelegationManager(address _owner).
contract DeployableDelegationManager is DelegationManager {
    constructor(address _owner) DelegationManager(_owner) {}
}
