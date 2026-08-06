// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IMinimalValidator, MODULE_TYPE_VALIDATOR } from "./IMinimalValidatorExecutor.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title OwnerEcdsaValidator
/// @notice Minimal ERC-7579 validator module (module type 1): authorizes actions for an
/// installing account via a single stored secp256k1 owner address (a standard "K1"/ECDSA
/// validator). Shared singleton -- state is keyed per installing account.
contract OwnerEcdsaValidator is IMinimalValidator {
    error AlreadyInitialized(address smartAccount);
    error NotInitialized(address smartAccount);

    mapping(address account => address owner) public owners;

    function onInstall(bytes calldata data) external override {
        if (owners[msg.sender] != address(0)) revert AlreadyInitialized(msg.sender);
        owners[msg.sender] = abi.decode(data, (address));
    }

    function onUninstall(bytes calldata /* data */) external override {
        if (owners[msg.sender] == address(0)) revert NotInitialized(msg.sender);
        delete owners[msg.sender];
    }

    function isInitialized(address smartAccount) external view override returns (bool) {
        return owners[smartAccount] != address(0);
    }

    function isModuleType(uint256 moduleTypeId) external view override returns (bool) {
        return moduleTypeId == MODULE_TYPE_VALIDATOR;
    }

    /// @dev Called by the account itself (msg.sender is the account) from within its
    /// own isValidSignature, so owners[msg.sender] resolves the calling account's owner.
    function isValidSignatureWithSender(
        address, /* sender */
        bytes32 hash,
        bytes calldata signature
    ) external view override returns (bytes4) {
        address owner = owners[msg.sender];
        if (owner != address(0) && ECDSA.recover(hash, signature) == owner) {
            return 0x1626ba7e; // EIP-1271 magic value
        }
        return 0xffffffff;
    }
}
