// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/// @title TxTraceLib
/// @notice Wrappers for the EIP-7906 TXTRACE (0xB6) and EVENTDATACOPY (0xB7) opcodes.
/// @dev `verbatim` (the usual way to emit an opcode Solidity doesn't know) only works in pure
///      Yul, not inline assembly, so these opcodes are exposed via two tiny oracle contracts
///      whose bytecode is hand-assembled and deployed with `deployOracles()`, then called
///      through staticcall.
library TxTraceLib {
    // TXTRACE pops [in2(top)=index, param(deeper)] directly; an earlier revision of this
    // runtime had a stray SWAP1 that swapped the two operands and made almost every query
    // revert (verified against a live devnet).
    bytes private constant TXTRACE_INITCODE =
        hex"600f600c600039600f6000f3600035602035b660005260206000f3";
    bytes private constant EVENTDATA_INITCODE =
        hex"6012600c60003960126000f36040356020356000600035b76040356000f3";

    /// @notice Deploys both oracle contracts. Called once per policy contract, in its
    ///         constructor.
    /// @return txOracle Address of the TXTRACE query oracle.
    /// @return edOracle Address of the EVENTDATACOPY oracle.
    function deployOracles() internal returns (address txOracle, address edOracle) {
        bytes memory txIC = TXTRACE_INITCODE;
        bytes memory edIC = EVENTDATA_INITCODE;
        assembly {
            txOracle := create(0, add(txIC, 0x20), mload(txIC))
            edOracle := create(0, add(edIC, 0x20), mload(edIC))
        }
        require(txOracle != address(0), "TXTRACE oracle deploy failed");
        require(edOracle != address(0), "EventData oracle deploy failed");
    }

    uint256 internal constant BALANCE_COUNT   = 0x00;
    uint256 internal constant STORAGE_COUNT   = 0x01;
    uint256 internal constant CONTRACT_COUNT  = 0x02;
    uint256 internal constant BALANCE_ADDRESS = 0x03;
    uint256 internal constant BALANCE_BEFORE  = 0x04;
    uint256 internal constant BALANCE_AFTER   = 0x05;
    uint256 internal constant STORAGE_ADDRESS = 0x06;
    uint256 internal constant STORAGE_SLOT    = 0x07;
    uint256 internal constant STORAGE_BEFORE  = 0x08;
    uint256 internal constant STORAGE_AFTER   = 0x09;
    uint256 internal constant CONTRACT_ADDR   = 0x0A;
    uint256 internal constant CONTRACT_HASH   = 0x0B;
    uint256 internal constant EVENT_COUNT     = 0x0C;
    uint256 internal constant EVENT_ADDRESS   = 0x0D;
    uint256 internal constant EVENT_TOPIC_CNT = 0x0E;
    uint256 internal constant EVENT_TOPIC0    = 0x0F;
    uint256 internal constant EVENT_TOPIC1    = 0x10;
    uint256 internal constant EVENT_TOPIC2    = 0x11;
    uint256 internal constant EVENT_TOPIC3    = 0x12;
    uint256 internal constant EVENT_DATA_LEN  = 0x13;

    /// @notice Calls TXTRACE(param, index) via the query oracle.
    /// @return result The U256 result returned by TXTRACE.
    function query(
        address oracle,
        uint256 param,
        uint256 index
    ) internal view returns (uint256 result) {
        (bool ok, bytes memory data) = oracle.staticcall(abi.encode(param, index));
        require(ok, "TxTrace query oracle failed");
        result = abi.decode(data, (uint256));
    }

    /// @notice Copies `length` bytes of event `eventIndex`'s non-indexed data, starting at
    ///         `dataOffset`, via the EVENTDATACOPY oracle.
    /// @dev Returns raw bytes, not ABI-encoded (unlike `query`).
    function getEventData(
        address oracle,
        uint256 eventIndex,
        uint256 dataOffset,
        uint256 length
    ) internal view returns (bytes memory data) {
        (bool ok, bytes memory raw) = oracle.staticcall(
            abi.encode(eventIndex, dataOffset, length)
        );
        require(ok, "EventData oracle failed");
        data = raw;
    }
}
