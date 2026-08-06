// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {TxTraceLib} from "../shared/TxTraceLib.sol";
import {EIP7906ExtendedLibrary} from "../shared/EIP7906ExtendedLibrary.sol";

/// @title PrivateSwapAssertion
/// @notice EIP-7906 POST_TX-frame assertion contract for the Hegotá private-swap demo:
/// after a private spend calls any DEX, this checks afterward that the recipient received
/// enough tokens, no unexpected funds or approvals moved, and any change was returned to
/// the pool. Same shape as RequiredEventAssertion.sol
/// (no constructor config, deploys its own oracle pair, called directly as a POST_TX
/// frame's target), composing the same checks MinOutputAssertion.sol/ApprovalCapAssertion.sol
/// use individually via their shared EIP7906ExtendedLibrary functions, plus a direct balance
/// read for the "change returned to the pool" check (a POST_TX frame runs after final state
/// settles, so reading PrivateSwapExecutor's own ETH balance directly is simpler and just as
/// legitimate as reconstructing it from TXTRACE events).
contract PrivateSwapAssertion {
    error ExecutorRetainedFunds(address executor, uint256 balance);

    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    /// @notice Reverts unless: `outToken` emitted a Transfer to `recipient` of at least
    ///         `minOutAmount`; no ERC-20 Approval event anywhere in the transaction exceeded
    ///         `maxApproval`; and `executor` (PrivateSwapExecutor) ended the transaction
    ///         holding zero ETH (proving any unspent withdrawal was re-shielded, not left
    ///         stranded in a contract nobody else can reach).
    function assertPrivateSwap(
        address outToken,
        address recipient,
        uint256 minOutAmount,
        uint256 maxApproval,
        address executor
    ) external view {
        EIP7906ExtendedLibrary.checkMinOutput(txTraceOracle, eventDataOracle, outToken, recipient, minOutAmount);
        EIP7906ExtendedLibrary.checkNoUnlimitedApproval(txTraceOracle, eventDataOracle, maxApproval);
        if (executor.balance != 0) revert ExecutorRetainedFunds(executor, executor.balance);
    }
}
