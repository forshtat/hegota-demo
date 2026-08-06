// SPDX-License-Identifier: MIT AND Apache-2.0
pragma solidity 0.8.23;
import { HybridDeleGator } from "@metamask/delegation-framework/HybridDeleGator.sol";
import { IDelegationManager } from "@metamask/delegation-framework/interfaces/IDelegationManager.sol";
import { IEntryPoint } from "@account-abstraction/interfaces/IEntryPoint.sol";

/// @dev Wrapper so Hardhat writes an artifact under artifacts/contracts/.
contract DeployableHybridDeleGator is HybridDeleGator {
    constructor(IDelegationManager _delegationManager, IEntryPoint _entryPoint)
        HybridDeleGator(_delegationManager, _entryPoint) {}
}
