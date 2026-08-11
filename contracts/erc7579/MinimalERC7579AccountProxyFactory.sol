// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MinimalERC7579AccountProxyFactory
/// @notice CREATE2 factory for MinimalERC7579AccountProxy -- a "clone with immutable args"
/// proxy whose deployed runtime delegatecalls a fixed MinimalERC7579Account implementation
/// and embeds its owner as 20 trailing bytes (read via EXTCODECOPY in the implementation's
/// own fallback, see MinimalERC7579Account.sol's _embeddedOwner). Deliberately not a plain
/// EIP-1167 clone: EIP-1167's template has no room for extra immutable data, and reading the
/// owner from any form of storage (an SSTORE, or a lookup on the installed validator) is too
/// expensive to fit inside EIP-8141's MAX_VERIFY_GAS budget for a self-funded deployment --
/// see MinimalERC7579Account.sol's own doc comment for why this split exists at all.
///
/// PROXY_TEMPLATE is MinimalERC7579AccountProxy.yul's compiled initcode (hand-verified by
/// disassembling every instruction against the intended calldatacopy+delegatecall+
/// returndatacopy forwarding logic, not hand-assembled from scratch) with two placeholder
/// regions patched at runtime rather than baked in at compile time:
/// - byte offset 28 (the DELEGATECALL target inside the runtime object, a PUSH20 operand):
///   all-0x11, patched to `implementation` once, in the constructor.
/// - byte offset 65 (the trailing "owner" data object, the full 85-byte template's tail):
///   all-zero, patched to `owner` per createAccount call.
contract MinimalERC7579AccountProxyFactory {
    event AccountCreated(address indexed owner, address account);

    address public immutable implementation;

    bytes private constant PROXY_TEMPLATE =
        hex"602e6014908060135f398160418239015ff3fe365f80375f8036817311111111111111111111111111111111111111115af43d5f803e15602a573d5ff35b3d5ffd0000000000000000000000000000000000000000";

    uint256 private constant IMPLEMENTATION_OFFSET = 28;
    uint256 private constant OWNER_OFFSET = 65;

    constructor(address _implementation) {
        implementation = _implementation;
    }

    function createAccount(address owner) external returns (address account) {
        bytes memory initcode = _initCodeFor(owner);
        bytes32 salt = _salt(owner);
        assembly {
            account := create2(0, add(initcode, 0x20), mload(initcode), salt)
        }
        require(account != address(0), "deploy failed");
        emit AccountCreated(owner, account);
    }

    function getAddress(address owner) external view returns (address) {
        bytes32 hash =
            keccak256(abi.encodePacked(bytes1(0xff), address(this), _salt(owner), keccak256(_initCodeFor(owner))));
        return address(uint160(uint256(hash)));
    }

    function _initCodeFor(address owner) private view returns (bytes memory code) {
        code = PROXY_TEMPLATE;
        _patch(code, IMPLEMENTATION_OFFSET, implementation);
        _patch(code, OWNER_OFFSET, owner);
    }

    /// @dev Overwrites the 20 bytes of `code` starting at `offset` with `value`'s bytes, one
    /// byte at a time (mstore8) rather than a single 32-byte mstore, which would spill 12
    /// bytes past a tightly-sized `bytes memory` buffer into unrelated adjacent memory.
    function _patch(bytes memory code, uint256 offset, address value) private pure {
        assembly {
            let base := add(add(code, 0x20), offset)
            for { let i := 0 } lt(i, 20) { i := add(i, 1) } {
                mstore8(add(base, i), byte(add(12, i), value))
            }
        }
    }

    function _salt(address owner) private pure returns (bytes32) {
        return keccak256(abi.encode(owner));
    }
}
