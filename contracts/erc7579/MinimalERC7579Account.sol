// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC7579Account } from "@erc7579/interfaces/IERC7579Account.sol";
import {
    IMinimalValidator, IMinimalExecutor, MODULE_TYPE_VALIDATOR, MODULE_TYPE_EXECUTOR
} from "./IMinimalValidatorExecutor.sol";
import { ModeLib, ModeCode, CallType, CALLTYPE_SINGLE } from "@erc7579/lib/ModeLib.sol";
import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";
import { SelfVerifyLib } from "./SelfVerifyLib.sol";

/// @title MinimalERC7579Account
/// @notice A self-contained ERC-7579 account IMPLEMENTATION: implements the real
/// IERC7579Account interface (isValidSignature delegates to an installed validator;
/// executeFromExecutor is gated to installed executors) but with its own lightweight
/// storage instead of Rhinestone's ModuleManager/SentinelList/HookManager stack.
///
/// Deployed exactly ONCE, as a shared singleton reached via DELEGATECALL from many tiny
/// MinimalERC7579AccountProxy instances (one per owner) -- NOT deployed per-account itself.
/// This split exists purely because of EIP-8141's `deploy+self_verify` validation-prefix gas
/// budget (`FRAME_TX_MAX_VERIFY_GAS = 100_000`, ethrex's `transaction.rs`): that budget covers
/// the deploy frame's own gas_limit too (confirmed directly against ethrex's source and by a
/// live test), so a self-funded account deployment (the account pays for its own CREATE2, not
/// the owner's EOA) can only ever deploy something proxy-sized (~65 bytes), never this
/// contract's full runtime. Every function here operates on whichever proxy's storage
/// delegatecalled in -- `installedValidator`/`installedExecutor`/`selfVerifyDispatcher` are
/// immutables baked into THIS shared implementation's own bytecode (correct here because
/// every account in this demo uses the same fixed validator/executor/dispatcher singletons,
/// not a genuinely per-account value), while `isValidatorInstalled`/`isExecutorInstalled` are
/// regular storage and therefore correctly per-proxy.
contract MinimalERC7579Account is IERC7579Account {
    error Unauthorized();
    error UnsupportedCallType();
    error CallFailed();
    error AlreadySetUp();

    mapping(address module => bool) public isValidatorInstalled;
    mapping(address module => bool) public isExecutorInstalled;

    address public immutable installedValidator;
    address public immutable installedExecutor;
    address public immutable selfVerifyDispatcher;

    constructor(address validator, address executor) {
        installedValidator = validator;
        installedExecutor = executor;
        selfVerifyDispatcher = SelfVerifyLib.deploy();
    }

    /// @notice Installs the fixed validator/executor into the CALLING PROXY's own storage
    /// (regular storage writes, so this only makes sense invoked via delegatecall from a
    /// proxy -- calling it directly on the shared implementation is harmless but pointless).
    /// Deliberately open/permissionless rather than onlySelf: `installedValidator`,
    /// `installedExecutor`, and each proxy's embedded owner (see _embeddedOwner) are all
    /// fixed, already-baked-in values, so this function's outcome is fully determined
    /// regardless of who calls it -- there's nothing for a third-party caller to corrupt.
    /// Called via a plain (non-frame or post-prefix) transaction, since installing a module
    /// (an external call plus an SSTORE) is far too expensive to fit in the deploy+self_verify
    /// frame tx's own MAX_VERIFY_GAS budget alongside the deploy itself.
    function completeSetup() external {
        if (isValidatorInstalled[installedValidator]) revert AlreadySetUp();
        isValidatorInstalled[installedValidator] = true;
        IMinimalValidator(installedValidator).onInstall(abi.encode(_embeddedOwner()));

        if (installedExecutor != address(0)) {
            isExecutorInstalled[installedExecutor] = true;
            IMinimalExecutor(installedExecutor).onInstall("");
        }
    }

    /// @notice The owner address MinimalERC7579AccountProxy embeds as its own trailing 20
    /// immutable bytes (a "clone with immutable args" proxy, not a plain EIP-1167 clone) --
    /// read via EXTCODECOPY of the CALLER's own code, which under delegatecall is this
    /// account's own address. Avoids needing any storage write (an installed-validator
    /// lookup) just to learn the owner during the deploy frame's own tight gas budget.
    function _embeddedOwner() internal view returns (address owner) {
        assembly {
            let size := extcodesize(address())
            extcodecopy(address(), 0x00, sub(size, 20), 20)
            owner := shr(96, mload(0x00))
        }
    }

    /// @notice Target of an EIP-8141 VERIFY(self) frame (see SelfVerifyLib) -- the frontend
    /// sends a non-empty sentinel payload so this routes here rather than to `receive()`,
    /// which stays untouched for plain ETH transfers (e.g. faucet claims, IN_TOKEN mints).
    /// Checks the proxy's own embedded owner (see _embeddedOwner), not any storage-based
    /// validator lookup -- this must work even before completeSetup() has ever run, since
    /// the very first self_verify happens in the same frame tx as the deploy itself.
    fallback() external payable {
        address dispatcher = selfVerifyDispatcher;
        address owner = _embeddedOwner();
        assembly {
            mstore(0x00, owner)
            let ok := delegatecall(gas(), dispatcher, 0x00, 0x20, 0x00, 0x00)
            returndatacopy(0x00, 0x00, returndatasize())
            switch ok
            case 0 { revert(0x00, returndatasize()) }
            default { return(0x00, returndatasize()) }
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
