// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockERC20 {
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol, address mintTo, uint256 supply) {
        name = _name;
        symbol = _symbol;
        totalSupply = supply;
        balanceOf[mintTo] = supply;
        emit Transfer(address(0), mintTo, supply);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "insufficient allowance");
        require(balanceOf[from] >= amount, "insufficient balance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }

    /// @notice Permissionless mint -- this is a test-fixture token with no real value (see
    /// MockSwap's own doc comment on being "a shared singleton on a public devnet"), so anyone
    /// can mint to any address. Lets a self-funded caller (e.g. the Hegotá demo's Demo Wallet
    /// self-provisioning flow) supply its own IN_TOKEN balance instead of depending on the
    /// deployer's fixed initial supply.
    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }
}
