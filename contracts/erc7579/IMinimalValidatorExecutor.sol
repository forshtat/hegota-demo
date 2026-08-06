// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// A minimal subset of ERC-7579's IERC7579Module/IValidator/IExecutor interfaces,
// covering exactly what this demo needs (onInstall/onUninstall/isModuleType/isInitialized,
// plus ERC-1271-style isValidSignatureWithSender). Deliberately omits validateUserOp:
// this demo never involves an ERC-4337 EntryPoint, and the real IERC7579Module.sol pulls
// in PackedUserOperation via a bare "account-abstraction/..." import that collides with
// an unrelated npm copy of the same package already in this repo's node_modules (the
// `erc7579-implementation` devDependency), producing a genuine Solidity type-identity
// clash. The rest of the real ERC-7579 surface (IERC7579Account, ModeLib, ExecutionLib)
// has no such dependency and is used unmodified -- see MinimalERC7579Account.sol.
uint256 constant MODULE_TYPE_VALIDATOR = 1;
uint256 constant MODULE_TYPE_EXECUTOR = 2;

interface IMinimalModule {
    function onInstall(bytes calldata data) external;
    function onUninstall(bytes calldata data) external;
    function isModuleType(uint256 moduleTypeId) external view returns (bool);
    function isInitialized(address smartAccount) external view returns (bool);
}

interface IMinimalValidator is IMinimalModule {
    function isValidSignatureWithSender(
        address sender,
        bytes32 hash,
        bytes calldata signature
    )
        external
        view
        returns (bytes4);
}

interface IMinimalExecutor is IMinimalModule { }
