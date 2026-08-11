// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title SelfVerifyLib
/// @notice Deploys a stateless dispatcher used by MinimalERC7579Account's fallback to act as
/// the target of an EIP-8141 `self_verify`/`deploy+self_verify` VERIFY frame: it reads the
/// resolved signer of signatures[0] via SIGPARAM (0xB4), compares it against the owner the
/// caller passes directly as calldata, and calls APPROVE (0xAA) with scope
/// APPROVE_EXECUTION_AND_PAYMENT (0x03) if they match, reverting otherwise.
/// @dev SIGPARAM/APPROVE are unreachable from Solidity (verbatim is Yul-only), so the
/// dispatcher's bytecode is hand-compiled from pure Yul (see SelfVerifyLib.yul this hex was
/// generated from, and verified by disassembly -- not hand-assembled from scratch) and
/// deployed via `create`, the same technique TxTraceLib uses for TXTRACE/EVENTDATACOPY.
/// Reached via DELEGATECALL (not staticcall like TxTraceLib's oracles) so `address(this)`/
/// APPROVE's `resolved_target == tx.sender` check resolve to the calling account, not this
/// dispatcher's own address. Calldata is `abi.encode(owner)` -- the caller (the account's own
/// fallback) must only ever pass its own trusted, embedded owner (see
/// MinimalERC7579Account.sol's `_embeddedOwner`), never one derived from external input, or
/// any caller could spoof approval by claiming to be whatever owner it likes.
library SelfVerifyLib {
    bytes private constant SELF_VERIFY_INITCODE =
        hex"6014600b5f3960145ff3fe5f355f5fb481810360105760035f5faa5b5f5ffd";

    /// @notice Deploys the dispatcher. Called once, by the shared implementation's own
    /// constructor (see MinimalERC7579Account.sol's doc comment on why there's only one).
    function deploy() internal returns (address dispatcher) {
        bytes memory ic = SELF_VERIFY_INITCODE;
        assembly {
            dispatcher := create(0, add(ic, 0x20), mload(ic))
        }
        require(dispatcher != address(0), "SelfVerify dispatcher deploy failed");
    }
}
