import { expect } from "chai";
import { ethers } from "hardhat";
import { getSigners } from "../helpers.js";

// Threat 1: Unlimited Token Approval Detection
// A transaction secretly includes approve(spender, MAX_UINT), granting an attacker
// the ability to drain all tokens later. NoUnlimitedApprovalEnforcer detects this
// by scanning TXTRACE events for Approval events with amount > threshold.
// Suspended: TXTRACE oracle calls must run in POST_TX frame (EIP-7906 + EthRex PR #6891).
// Policy logic is correct; migrate to frame transactions — see test/frame-assertions/.
describe.skip("MetaMask Delegation — NoUnlimitedApprovalEnforcer", function () {

  async function deploy() {
    const { deployer } = await getSigners();

    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("TestToken", "TTK", deployer.address, 1_000_000n);
    await token.waitForDeployment();

    const maxAllowableApproval = 1000n;
    const terms = ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256"],
      [maxAllowableApproval],
    );

    const Enforcer = await ethers.getContractFactory("NoUnlimitedApprovalEnforcer");
    const enforcer = await Enforcer.deploy();
    await enforcer.waitForDeployment();

    const Manager = await ethers.getContractFactory("MockDelegationManager");
    const manager = await Manager.deploy();
    await manager.waitForDeployment();

    return { token, enforcer, manager, terms };
  }

  it("limited approval — passes", async function () {
    const { token, enforcer, manager, terms } = await deploy();

    const spender = ethers.Wallet.createRandom().address;
    const callData = token.interface.encodeFunctionData("approve", [spender, 100n]);

    await expect(
      manager.execute(
        await token.getAddress(),
        callData,
        await enforcer.getAddress(),
        terms,
      ),
    ).to.not.be.reverted;
  });

  it("unlimited approval (MAX_UINT) — reverts", async function () {
    const { token, enforcer, manager, terms } = await deploy();

    const spender = ethers.Wallet.createRandom().address;
    const callData = token.interface.encodeFunctionData("approve", [
      spender,
      ethers.MaxUint256,
    ]);

    await expect(
      manager.execute(
        await token.getAddress(),
        callData,
        await enforcer.getAddress(),
        terms,
      ),
    ).to.be.revertedWithCustomError(enforcer, "UnlimitedApprovalDetected");
  });
});
