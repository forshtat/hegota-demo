// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title ExactBeneficiaryAssertion
/// @notice EIP-7906 POST_TX-frame assertion contract for the hidden-ETH-drain demo. Same
/// shape as MinOutputAssertion.sol/ApprovalCapAssertion.sol (no constructor config, deploys
/// its own oracle pair, called directly as a POST_TX frame's target) -- unlike those two,
/// this one scans the `BALANCE_*` TXTRACE family (native ETH balance-delta records) instead
/// of the `EVENT_*` family, mirroring EIP7906ExtendedLibrary.checkExactBeneficiary's proven
/// logic: any address other than `expectedBeneficiary` whose ETH balance rose during the
/// transaction is an unauthorized (hidden) recipient.
contract ExactBeneficiaryAssertion {
    error UnexpectedRecipient(address addr);

    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    /// @notice Assert that no address other than `expectedBeneficiary` gained ETH during the
    ///         transaction. Reverts with UnexpectedRecipient if a hidden recipient is found.
    function assertExactBeneficiary(address expectedBeneficiary) external view {
        uint256 n = TxTraceLib.query(txTraceOracle, TxTraceLib.BALANCE_COUNT, 0);

        for (uint256 i = 0; i < n; i++) {
            uint256 balBefore = TxTraceLib.query(txTraceOracle, TxTraceLib.BALANCE_BEFORE, i);
            uint256 balAfter = TxTraceLib.query(txTraceOracle, TxTraceLib.BALANCE_AFTER, i);
            if (balAfter <= balBefore) continue;

            address addr = address(uint160(TxTraceLib.query(txTraceOracle, TxTraceLib.BALANCE_ADDRESS, i)));
            if (addr != expectedBeneficiary) revert UnexpectedRecipient(addr);
        }
    }
}
