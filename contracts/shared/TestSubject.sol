// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IERC20Min {
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @title TestSubject
/// @notice A configurable subject contract used across all integration test scenarios.
contract TestSubject {
    event Transfer(address indexed to, uint256 amount);
    event Arbitrary(bytes32 indexed topic, bytes data);

    mapping(bytes32 => uint256) public slots;

    /// @notice Emits a Transfer event (topic0 = Transfer.selector) with `amount` as data.
    function emitTransfer(address to, uint256 amount) external {
        emit Transfer(to, amount);
    }

    /// @notice Emits an Arbitrary event with a caller-specified topic.
    function emitArbitrary(bytes32 topic, bytes calldata data) external {
        emit Arbitrary(topic, data);
    }

    /// @notice Writes a value to a named storage slot.
    function writeSlot(bytes32 slot, uint256 value) external {
        slots[slot] = value;
    }

    /// @notice Sends ETH to `recipient`. The caller must send enough value.
    function sendEth(address payable recipient, uint256 amount) external payable {
        (bool ok,) = recipient.call{value: amount}("");
        require(ok, "ETH send failed");
    }

    /// @notice Sends ETH to two recipients in one call.
    function sendEthToTwo(
        address payable r1, uint256 a1,
        address payable r2, uint256 a2
    ) external payable {
        (bool ok1,) = r1.call{value: a1}("");
        require(ok1, "first ETH send failed");
        (bool ok2,) = r2.call{value: a2}("");
        require(ok2, "second ETH send failed");
    }

    /// @notice Calls ERC-20 transfer on an external token contract.
    function transferERC20(address token, address to, uint256 amount) external {
        IERC20Min(token).transfer(to, amount);
    }

    /// @notice Calls ERC-20 approve on an external token contract.
    function approveERC20(address token, address spender, uint256 amount) external {
        IERC20Min(token).approve(spender, amount);
    }

    /// @notice Deploys a minimal contract that returns nothing and stores nothing.
    function deployContract() external returns (address deployed) {
        bytes memory initCode = hex"00"; // STOP
        assembly {
            deployed := create(0, add(initCode, 0x20), mload(initCode))
        }
        require(deployed != address(0), "deploy failed");
    }

    receive() external payable {}
}
