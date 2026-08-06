// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title BenignSafeDelegate
/// @notice Compliant/benign counterpart to MaliciousSafeDelegate.sol for the Control-Plane
/// Takeover demo. `authorizeViaSafe` (frontend/src/hegotaScenarios/types.ts) unconditionally
/// dispatches the scenario's DEFAULT-frame action via `Safe.execTransaction` with
/// `operation == 1` (DELEGATECALL) -- there is no CALL-mode escape hatch -- so BOTH the
/// compliant and violating variants of `controlPlaneTakeoverScenario`'s `buildAction` execute
/// in the Safe's OWN storage context, not this contract's. `noop()` is therefore marked
/// `pure`, which the compiler enforces means zero storage reads or writes: delegatecalling
/// into it can never corrupt the Safe's control-plane storage (or any other storage),
/// regardless of whose context it runs in. Kept as a separate, single-purpose contract
/// rather than adding a second function to MaliciousSafeDelegate.sol, which stays
/// malicious-only.
contract BenignSafeDelegate {
    /// @notice Does nothing. `pure` guarantees no storage access at compile time -- the
    /// property this contract exists to provide.
    function noop() external pure {}
}
