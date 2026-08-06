import type { HardhatUserConfig } from "hardhat/types/config";
import hardhatEthersPlugin from "@nomicfoundation/hardhat-ethers";
import hardhatMochaPlugin from "@nomicfoundation/hardhat-mocha";
import hardhatFoundry from "@nomicfoundation/hardhat-foundry";
import "dotenv/config";

const config: HardhatUserConfig = {
  plugins: [hardhatEthersPlugin, hardhatMochaPlugin, hardhatFoundry],
  solidity: {
    profiles: {
      default: {
        compilers: [
          {
            version: "0.8.28",
            settings: {
              optimizer: { enabled: true, runs: 200 },
              // viaIR required for verbatim builtins used in TxTraceLib
              viaIR: true,
            },
          },
          {
            // delegation-framework uses fixed pragma solidity 0.8.23
            // viaIR is intentionally off: SCL's P256 implementation overflows
            // the Yul stack under the IR pipeline. MetaMask ships without via_ir too.
            version: "0.8.23",
            settings: {
              optimizer: { enabled: true, runs: 200 },
              viaIR: false,
            },
          },
        ],
      },
    },
  },
  networks: {
    ethrex: {
      type: "http",
      url: process.env.ETHREX_RPC_URL ?? "http://localhost:8545",
      chainId: parseInt(process.env.ETHREX_CHAIN_ID ?? "1337"),
      accounts: process.env.ETHREX_PRIVATE_KEY
        ? [process.env.ETHREX_PRIVATE_KEY]
        : "remote",
    },
    hegota: {
      type: "http",
      url: process.env.HEGOTA_RPC_URL ?? "https://rpc1.hegota.ethrex.xyz",
      chainId: parseInt(process.env.HEGOTA_CHAIN_ID ?? "3151908"),
      accounts: process.env.HEGOTA_PRIVATE_KEY
        ? [process.env.HEGOTA_PRIVATE_KEY]
        : "remote",
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
