// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC7579Hook} from "./IERC7579Hook.sol";
import {EIP7906ExtendedLibrary} from "../shared/EIP7906ExtendedLibrary.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title ExactBeneficiaryHook
/// @notice ERC-7579 hook that ensures ETH flows only to a single expected recipient,
///         detecting hidden ETH drains embedded in multicall or delegated transactions.
///
/// Threat: a transaction claims to send ETH to a legitimate target but secretly also
///         sends ETH to an attacker address (e.g., via a hidden sub-call or multicall leg).
///
/// Detection: scan TXTRACE balance changes after execution; any address whose balance
///            increased that is not the declared allowed recipient → revert.
///
/// hookData (32 bytes): abi.encode(address allowedRecipient)
///
/// Gas-fee safety: gas deductions always decrease balance, never increase it, so the
/// tx payer never triggers a false positive in this check.
contract ExactBeneficiaryHook is IERC7579Hook {
    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    function preCheck(address, uint256, bytes calldata msgData)
        external pure override returns (bytes memory hookData)
    {
        return msgData[:32];
    }

    function postCheck(bytes calldata hookData) external view override {
        address allowedRecipient = abi.decode(hookData, (address));
        EIP7906ExtendedLibrary.checkExactBeneficiary(txTraceOracle, allowedRecipient);
    }
}
