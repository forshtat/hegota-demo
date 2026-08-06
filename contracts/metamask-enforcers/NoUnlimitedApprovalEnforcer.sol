// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {ICaveatEnforcer} from "@metamask/delegation-framework/interfaces/ICaveatEnforcer.sol";
import {ModeCode} from "@erc7579/lib/ModeLib.sol";
import {EIP7906ExtendedLibrary} from "../shared/EIP7906ExtendedLibrary.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title NoUnlimitedApprovalEnforcer
/// @notice ERC-7710 afterHook enforcer that detects unlimited ERC-20 approvals via TXTRACE.
///
/// Threat: a transaction secretly includes an ERC-20 approve(spender, MAX_UINT), granting
///         the attacker the ability to drain all tokens later.
///
/// Detection: scan all events emitted by the transaction; if any Approval event carries
///            an amount exceeding the configured threshold → revert.
///
/// terms encoding: abi.encode(uint256 maxAllowableApproval)
contract NoUnlimitedApprovalEnforcer is ICaveatEnforcer {
    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    function beforeAllHook(
        bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address
    ) external pure override {}

    function beforeHook(
        bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address
    ) external pure override {}

    function afterHook(
        bytes calldata terms,
        bytes calldata,
        ModeCode,
        bytes calldata,
        bytes32,
        address,
        address
    ) external view override {
        uint256 maxAllowableApproval = abi.decode(terms, (uint256));
        EIP7906ExtendedLibrary.checkNoUnlimitedApproval(txTraceOracle, eventDataOracle, maxAllowableApproval);
    }

    function afterAllHook(
        bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address
    ) external pure override {}
}
