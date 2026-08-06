// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC7579Account } from "@erc7579/interfaces/IERC7579Account.sol";
import {
    IMinimalValidator, IMinimalExecutor, MODULE_TYPE_VALIDATOR, MODULE_TYPE_EXECUTOR
} from "./IMinimalValidatorExecutor.sol";
import { ModeLib, ModeCode, CallType, CALLTYPE_SINGLE } from "@erc7579/lib/ModeLib.sol";
import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";

/// @title MinimalERC7579Account
/// @notice A self-contained ERC-7579 account: implements the real IERC7579Account
/// interface (isValidSignature delegates to an installed validator; executeFromExecutor
/// is gated to installed executors) but with its own lightweight storage instead of
/// Rhinestone's ModuleManager/SentinelList/HookManager stack. Its validator and executor
/// are installed once, in the constructor -- there is no runtime installModule support,
/// which is out of scope for this demo.
contract MinimalERC7579Account is IERC7579Account {
    error Unauthorized();
    error UnsupportedCallType();
    error CallFailed();

    mapping(address module => bool) public isValidatorInstalled;
    mapping(address module => bool) public isExecutorInstalled;

    constructor(address validator, bytes memory validatorInitData, address executor, bytes memory executorInitData) {
        isValidatorInstalled[validator] = true;
        IMinimalValidator(validator).onInstall(validatorInitData);

        if (executor != address(0)) {
            isExecutorInstalled[executor] = true;
            IMinimalExecutor(executor).onInstall(executorInitData);
        }
    }

    modifier onlyExecutorModule() {
        if (!isExecutorInstalled[msg.sender]) revert Unauthorized();
        _;
    }

    modifier onlySelf() {
        if (msg.sender != address(this)) revert Unauthorized();
        _;
    }

    /// @dev No ERC-4337 EntryPoint is involved in this demo, so this is restricted to
    /// self-calls only (still interface-compliant; simply unreachable from the outside).
    function execute(ModeCode mode, bytes calldata executionCalldata) external payable override onlySelf {
        _execute(mode, executionCalldata);
    }

    function executeFromExecutor(
        ModeCode mode,
        bytes calldata executionCalldata
    )
        external
        payable
        override
        onlyExecutorModule
        returns (bytes[] memory returnData)
    {
        return _execute(mode, executionCalldata);
    }

    function _execute(
        ModeCode mode,
        bytes calldata executionCalldata
    )
        private
        returns (bytes[] memory returnData)
    {
        (CallType callType,,,) = ModeLib.decode(mode);
        if (CallType.unwrap(callType) != CallType.unwrap(CALLTYPE_SINGLE)) revert UnsupportedCallType();

        (address target, uint256 value, bytes calldata callData) = ExecutionLib.decodeSingle(executionCalldata);
        (bool ok, bytes memory result) = target.call{ value: value }(callData);
        if (!ok) {
            assembly {
                revert(add(result, 0x20), mload(result))
            }
        }
        returnData = new bytes[](1);
        returnData[0] = result;
    }

    function isValidSignature(bytes32 hash, bytes calldata data) external view override returns (bytes4) {
        address validator = address(bytes20(data[0:20]));
        if (!isValidatorInstalled[validator]) return 0xffffffff;
        return IMinimalValidator(validator).isValidSignatureWithSender(msg.sender, hash, data[20:]);
    }

    function installModule(uint256, address, bytes calldata) external payable override onlySelf {
        revert("installModule not supported");
    }

    function uninstallModule(uint256, address, bytes calldata) external payable override onlySelf {
        revert("uninstallModule not supported");
    }

    function supportsExecutionMode(ModeCode encodedMode) external view override returns (bool) {
        (CallType callType,,,) = ModeLib.decode(encodedMode);
        return CallType.unwrap(callType) == CallType.unwrap(CALLTYPE_SINGLE);
    }

    function supportsModule(uint256 moduleTypeId) external view override returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR || moduleTypeId == MODULE_TYPE_EXECUTOR;
    }

    function isModuleInstalled(
        uint256 moduleTypeId,
        address module,
        bytes calldata /* additionalContext */
    )
        external
        view
        override
        returns (bool)
    {
        if (moduleTypeId == MODULE_TYPE_VALIDATOR) return isValidatorInstalled[module];
        if (moduleTypeId == MODULE_TYPE_EXECUTOR) return isExecutorInstalled[module];
        return false;
    }

    function accountId() external view override returns (string memory) {
        return "eip7906-validation.minimal-erc7579-account.1.0.0";
    }

    receive() external payable {}
}
