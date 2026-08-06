// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IShieldedPoolClaim {
    function claimWithdrawal(address payable who) external;
    function shield(bytes32 inner) external payable returns (uint32 index);
}

interface IMockSwapETH {
    function swap(address recipient) external payable returns (uint256 amountOut);
}

/// @title PrivateSwapExecutor
/// @notice The DEFAULT frame's target in the Hegotá private-swap demo transaction
/// (`[VERIFY(pool self-pay), SENDER(pool.withdraw), DEFAULT(this.executeSwap), POST_TX(assert)]`).
/// The withdraw frame credits this contract's `withdrawalCredit` in the pool (a pull claim,
/// not a push transfer -- see ShieldedPoolLogic.sol's claimWithdrawal doc); this contract
/// pulls it, swaps part of it via MockSwapETH, and re-shields any leftover back into the
/// pool as a fresh note: a private spend calls any DEX, and whatever isn't spent stays
/// shielded.
///
/// `changeInner` is the new note's `inner` value (owner_pk/rho commitment), computed
/// client-side ahead of time: shield() hashes in `msg.value` on-chain, so the wallet only
/// needs to commit to `inner` up front, independent of the exact leftover amount.
///
/// Permissionless by design, like MockSwap.sol's caller-identity tradeoffs: a DEFAULT
/// frame's caller is the protocol's ENTRY_POINT pseudo-address, not an account this
/// contract controls or can usefully gate on, and `withdrawalCredit` is a shared per-address
/// balance in the pool (not scoped to one specific withdraw), so on a public devnet a third
/// party could in principle call `executeSwap` against credit intended for someone else's
/// pending swap. Out of scope for this demo (same caveat as MockSwap's shared mutable
/// rate) -- the blast radius is testnet ETH already inside this one demo's own contracts.
contract PrivateSwapExecutor {
    IShieldedPoolClaim public immutable pool;
    IMockSwapETH public immutable swap;

    constructor(address _pool, address _swap) {
        pool = IShieldedPoolClaim(_pool);
        swap = IMockSwapETH(_swap);
    }

    /// @param swapAmount how much of the claimed withdrawal to swap; the rest is re-shielded.
    /// @param recipient who receives the swapped-out ERC20 tokens (independent of the pool
    ///        withdrawal's own recipient, which is always this contract).
    /// @param changeInner the pre-committed `inner` value for the re-shielded change note;
    ///        ignored if there is no leftover.
    function executeSwap(uint256 swapAmount, address recipient, bytes32 changeInner) external {
        uint256 before = address(this).balance;
        pool.claimWithdrawal(payable(address(this)));
        uint256 claimed = address(this).balance - before;
        require(swapAmount <= claimed, "swapAmount exceeds claimed withdrawal");

        swap.swap{value: swapAmount}(recipient);

        uint256 leftover = claimed - swapAmount;
        if (leftover > 0) {
            pool.shield{value: leftover}(changeInner);
        }
    }

    // Accepts the pool's claimWithdrawal push.
    receive() external payable {}
}
