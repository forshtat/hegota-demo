import { expect } from "chai";
import { ethers } from "hardhat";
import { fundAddress, getSigners } from "../helpers.js";

// Suspended: TXTRACE oracle calls must run in POST_TX frame (EIP-7906 + EthRex PR #6891).
// Policy logic is correct; migrate to frame transactions — see test/frame-assertions/.
describe.skip("MetaMask Delegation — SpendingLimitEnforcer", function () {

  async function deploy() {
    const { deployer } = await getSigners();

    const Subject = await ethers.getContractFactory("TestSubject");
    const subject = await Subject.deploy();
    await subject.waitForDeployment();

    const Enforcer = await ethers.getContractFactory("SpendingLimitEnforcer");
    const enforcer = await Enforcer.deploy();
    await enforcer.waitForDeployment();

    const Manager = await ethers.getContractFactory("MockDelegationManager");
    const manager = await Manager.deploy();
    await manager.waitForDeployment();

    // Fund the manager with 500 ETH so it can forward value on delegated calls
    await fundAddress(deployer, await manager.getAddress(), "500");

    return { subject, enforcer, manager, deployer };
  }

  it("spending limit: within limit — transfer succeeds", async function () {
    const { subject, enforcer, manager } = await deploy();

    const recipient = ethers.Wallet.createRandom().address;
    const transferAmount = ethers.parseEther("50");
    const limit = ethers.parseEther("100");
    const managerAddr = await manager.getAddress();

    const terms = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [managerAddr, limit],
    );

    const callData = subject.interface.encodeFunctionData("sendEth", [
      recipient,
      transferAmount,
    ]);

    await expect(
      manager.execute(
        await subject.getAddress(),
        callData,
        await enforcer.getAddress(),
        terms,
        { value: transferAmount },
      ),
    ).to.not.be.reverted;
  });

  it("spending limit: exceeds limit — enforcer reverts", async function () {
    const { subject, enforcer, manager } = await deploy();

    const recipient = ethers.Wallet.createRandom().address;
    const transferAmount = ethers.parseEther("200");
    const limit = ethers.parseEther("100");
    const managerAddr = await manager.getAddress();

    const terms = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [managerAddr, limit],
    );

    const callData = subject.interface.encodeFunctionData("sendEth", [
      recipient,
      transferAmount,
    ]);

    await expect(
      manager.execute(
        await subject.getAddress(),
        callData,
        await enforcer.getAddress(),
        terms,
        { value: transferAmount },
      ),
    ).to.be.revertedWithCustomError(enforcer, "SpendingLimitExceeded");
  });
});
