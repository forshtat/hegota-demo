// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { MinimalERC7579Account } from "./MinimalERC7579Account.sol";

/// @title MinimalERC7579AccountFactory
/// @notice Permissionless CREATE2 factory for MinimalERC7579Account: deployment can be
/// sponsored by any relay key on behalf of a given owner, without that owner needing to
/// hold funds or sign anything -- and the account's address is deterministic per owner,
/// so a returning demo visitor's account address is stable across sessions.
contract MinimalERC7579AccountFactory {
    event AccountCreated(address indexed owner, address account);

    function createAccount(address validator, address executor, address owner) external returns (address account) {
        account = address(
            new MinimalERC7579Account{ salt: _salt(owner) }(validator, abi.encode(owner), executor, "")
        );
        emit AccountCreated(owner, account);
    }

    function getAddress(address validator, address executor, address owner) external view returns (address) {
        bytes memory creationCode = abi.encodePacked(
            type(MinimalERC7579Account).creationCode, abi.encode(validator, abi.encode(owner), executor, bytes(""))
        );
        bytes32 hash =
            keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(owner), keccak256(creationCode)));
        return address(uint160(uint256(hash)));
    }

    function _salt(address owner) private pure returns (bytes32) {
        return keccak256(abi.encode(owner));
    }
}
