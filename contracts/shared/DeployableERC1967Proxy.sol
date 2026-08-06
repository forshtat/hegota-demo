// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @dev Wrapper so Hardhat writes an artifact we can use to deploy UUPS proxies.
contract DeployableERC1967Proxy is ERC1967Proxy {
    constructor(address implementation, bytes memory _data) ERC1967Proxy(implementation, _data) {}
}
