// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IMinimalExecutor, MODULE_TYPE_EXECUTOR } from "./IMinimalValidatorExecutor.sol";
import { IERC7579Account } from "@erc7579/interfaces/IERC7579Account.sol";
import { ModeLib } from "@erc7579/lib/ModeLib.sol";
import { ExecutionLib } from "@erc7579/lib/ExecutionLib.sol";

/// @title PostTxExecutor
/// @notice Minimal ERC-7579 executor module (module type 2): the entrypoint an EIP-8141
/// frame transaction's DEFAULT frame calls directly. Verifies an EIP-712 signature
/// against the account's installed validator (ERC-1271, via IERC7579Account.isValidSignature)
/// before forwarding the call -- so the demo action is genuinely authorized by whichever
/// key the account's validator trusts, not merely decorative.
///
/// value is always 0 here: the demo action never needs to move ETH, so it's omitted from
/// the signed struct entirely (kept in exact sync with frontend/src/contracts/postTxAction.ts).
contract PostTxExecutor is IMinimalExecutor {
    error InvalidSignature();

    // keccak256("PostTxAction(address account,address target,bytes callData,uint256 nonce)")
    bytes32 private constant POST_TX_ACTION_TYPEHASH =
        keccak256("PostTxAction(address account,address target,bytes callData,uint256 nonce)");

    string private constant DOMAIN_NAME = unicode"Hegotá POST_TX Demo";
    string private constant DOMAIN_VERSION = "1";

    mapping(address account => uint256 nonce) public nonces;

    function onInstall(bytes calldata /* data */) external override {}
    function onUninstall(bytes calldata /* data */) external override {}

    function isInitialized(address /* smartAccount */) external view override returns (bool) {
        return true;
    }

    function isModuleType(uint256 moduleTypeId) external view override returns (bool) {
        return moduleTypeId == MODULE_TYPE_EXECUTOR;
    }

    /// @notice The exact EIP-712 digest that must be signed to authorize the next call
    /// for `account`, computed on-chain so callers never have to reproduce the domain
    /// separator themselves. Does not consume the nonce.
    function nextActionHash(
        address account,
        address target,
        bytes calldata callData
    ) external view returns (bytes32) {
        return _actionHash(account, target, callData, nonces[account]);
    }

    /// @notice Verifies `signature` against `account`'s installed `validator` for the
    /// action (target, callData) at the account's current nonce, then forwards the call
    /// via IERC7579Account.executeFromExecutor. Reverts the whole call on a bad signature.
    function executeAction(
        address account,
        address validator,
        address target,
        bytes calldata callData,
        bytes calldata signature
    ) external returns (bytes memory) {
        uint256 nonce = nonces[account]++;
        bytes32 actionHash = _actionHash(account, target, callData, nonce);
        bytes memory sigWithValidator = abi.encodePacked(validator, signature);
        if (IERC7579Account(account).isValidSignature(actionHash, sigWithValidator) != 0x1626ba7e) {
            revert InvalidSignature();
        }
        bytes[] memory results = IERC7579Account(account).executeFromExecutor(
            ModeLib.encodeSimpleSingle(),
            ExecutionLib.encodeSingle(target, 0, callData)
        );
        return results.length > 0 ? results[0] : bytes("");
    }

    function _domainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId)"),
                keccak256(bytes(DOMAIN_NAME)),
                keccak256(bytes(DOMAIN_VERSION)),
                block.chainid
            )
        );
    }

    function _actionHash(
        address account,
        address target,
        bytes calldata callData,
        uint256 nonce
    ) private view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(POST_TX_ACTION_TYPEHASH, account, target, keccak256(callData), nonce)
        );
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), structHash));
    }
}
