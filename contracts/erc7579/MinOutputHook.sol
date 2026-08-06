// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC7579Hook} from "./IERC7579Hook.sol";
import {EIP7906ExtendedLibrary} from "../shared/EIP7906ExtendedLibrary.sol";
import {TxTraceLib} from "../shared/TxTraceLib.sol";

/// @title MinOutputHook
/// @notice ERC-7579 hook that asserts a minimum ERC-20 token output was received
///         within the transaction via TXTRACE.
/// Mirrors the ERC-6900 MinOutputHook for the ERC-7579 framework.
///
/// hookData (96 bytes): abi.encode(address token, address recipient, uint256 minAmount)
contract MinOutputHook is IERC7579Hook {
    address public immutable txTraceOracle;
    address public immutable eventDataOracle;

    constructor() {
        (txTraceOracle, eventDataOracle) = TxTraceLib.deployOracles();
    }

    function preCheck(address, uint256, bytes calldata msgData)
        external pure override returns (bytes memory hookData)
    {
        return msgData[:96];
    }

    function postCheck(bytes calldata hookData) external view override {
        (address token, address recipient, uint256 minAmount) =
            abi.decode(hookData, (address, address, uint256));
        EIP7906ExtendedLibrary.checkMinOutput(txTraceOracle, eventDataOracle, token, recipient, minAmount);
    }
}
