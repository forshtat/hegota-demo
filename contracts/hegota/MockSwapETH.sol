// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMockERC20Transfer {
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @title MockSwapETH
/// @notice A deliberately minimal "DEX" for the private-swap demo: swaps native ETH for
/// `outToken` at a stored, adjustable rate. Not a real AMM -- same minimal-mock philosophy
/// as MockSwap.sol (used by the MEV Sandwich / Oracle Manipulation demos), but ETH-in
/// instead of ERC20-in, since the shielded pool pays out native ETH only and this avoids a
/// WETH-wrapping detour.
///
/// Unlike MockSwap.sol, `swap` takes no explicit `from`: the caller sends the input amount
/// directly as `msg.value`, so there is no ERC20 allowance/transferFrom step whose caller
/// identity would matter. It is called by PrivateSwapExecutor, not directly by a frame.
contract MockSwapETH {
    address public immutable outToken;
    address public immutable owner;
    uint256 public constant RATE_DENOMINATOR = 1e18;
    uint256 public immutable defaultRateNumerator;

    // 0 means "no override yet for this recipient" -- see rateNumerator().
    mapping(address => uint256) private _rateOverride;

    constructor(address _outToken, uint256 initialRateNumerator) {
        outToken = _outToken;
        defaultRateNumerator = initialRateNumerator;
        owner = msg.sender;
    }

    /// @notice amountOut = msg.value * rateNumerator(recipient) / RATE_DENOMINATOR for a
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

    function swap(address recipient) external payable returns (uint256 amountOut) {
        amountOut = (msg.value * rateNumerator(recipient)) / RATE_DENOMINATOR;
        require(IMockERC20Transfer(outToken).transfer(recipient, amountOut), "transfer failed");
    }
}
