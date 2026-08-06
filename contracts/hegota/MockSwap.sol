// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMockERC20Transfer {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title MockSwap
/// @notice A deliberately minimal "DEX" for the MinOutput / anti-sandwich demo: swaps
/// `inToken` for `outToken` at a stored, adjustable rate. Not a real AMM (no
/// constant-product curve, no liquidity accounting) -- just enough state-dependent price
/// behavior that "simulate the swap via eth_call, then verify the real outcome via
/// TXTRACE" is a genuine live check rather than an already-known constant. `setRate` lets
/// the demo move the price between when a user simulates a swap and when it actually
/// executes, modeling a sandwich attack or oracle TOCTOU manipulation.
///
/// The rate is scoped per `recipient` rather than being a single global value: this is a
/// shared singleton on a public devnet used by every visitor of the demo, and a global rate
/// meant that one visitor's "attack" run permanently moved the price for everyone else
/// (including their own later "compliant" runs), producing spurious failures unrelated to
/// the run in question. Each recipient starts at `defaultRateNumerator` until `setRate` is
/// called for that specific recipient.
///
/// `swap` takes an explicit `from` rather than using `msg.sender`: an EIP-8141 DEFAULT
/// frame's caller is the protocol's ENTRY_POINT pseudo-address, not the frame tx's sender
/// or any account we control, so a real caller-authenticated router isn't reachable from a
/// plain DEFAULT frame without also routing through the ERC-7579 smart-account executor
/// path (out of scope for this first scenario -- see PostTxExecutor.sol for that pattern
/// elsewhere in this demo). Real permit2-style routers use the same explicit-`from` shape.
contract MockSwap {
    address public immutable inToken;
    address public immutable outToken;
    address public immutable owner;
    uint256 public constant RATE_DENOMINATOR = 1e18;
    uint256 public immutable defaultRateNumerator;

    // 0 means "no override yet for this recipient" -- see rateNumerator().
    mapping(address => uint256) private _rateOverride;

    constructor(address _inToken, address _outToken, uint256 initialRateNumerator) {
        inToken = _inToken;
        outToken = _outToken;
        defaultRateNumerator = initialRateNumerator;
        owner = msg.sender;
    }

    /// @notice amountOut = amountIn * rateNumerator(recipient) / RATE_DENOMINATOR for a
    /// swap paying out to `recipient`. Falls back to defaultRateNumerator until that
    /// recipient's rate has been explicitly overridden via setRate.
    function rateNumerator(address recipient) public view returns (uint256) {
        uint256 overridden = _rateOverride[recipient];
        return overridden == 0 ? defaultRateNumerator : overridden;
    }

    function setRate(address recipient, uint256 newRateNumerator) external {
        require(msg.sender == owner, "not owner");
        require(newRateNumerator != 0, "rate must be nonzero");
        _rateOverride[recipient] = newRateNumerator;
    }

    function swap(address from, uint256 amountIn, address recipient) external returns (uint256 amountOut) {
        require(IMockERC20Transfer(inToken).transferFrom(from, address(this), amountIn), "transferFrom failed");
        amountOut = (amountIn * rateNumerator(recipient)) / RATE_DENOMINATOR;
        require(IMockERC20Transfer(outToken).transfer(recipient, amountOut), "transfer failed");
    }
}
