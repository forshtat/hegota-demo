import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestSubject, getSigners } from "../helpers.js";

// Threats 4+5: MEV Sandwich Protection and Oracle TOCTOU Attack
//
// Both threats manifest identically on-chain: the output token Transfer to the
// expected recipient is below the minimum acceptable amount.
//
//   MEV sandwich:   attacker front/back-runs a swap → user receives fewer output tokens
//   Oracle TOCTOU:  oracle price is manipulated between simulation and inclusion →
//                   execution happens at a worse price → fewer output tokens
//
// MinOutputHook detects both by asserting that a Transfer(from=any, to=recipient,
// value>=minAmount) event from the output token contract occurred in the transaction.

// Suspended: TXTRACE oracle calls must run in POST_TX frame (EIP-7906 + EthRex PR #6891).
// Policy logic is correct; migrate to frame transactions — see test/frame-assertions/.
describe.skip("ERC-6900 — MinOutputHook (MEV sandwich + Oracle TOCTOU protection)", function () {

  const ENTITY_ID = 1;
  const MIN_AMOUNT = 900n;

  async function deploy() {
    const { user } = await getSigners();
    const subject = await deployTestSubject();

    // Mint all tokens to subject — subject acts as the simulated DEX/settlement contract
    const Token = await ethers.getContractFactory("MockERC20");
    const token = await Token.deploy("OutToken", "OUT", await subject.getAddress(), 1_000_000n);
    await token.waitForDeployment();

    const Hook = await ethers.getContractFactory("MinOutputHook");
    const hook = await Hook.deploy();
    await hook.waitForDeployment();

    const Account = await ethers.getContractFactory("MockModularAccount");
    const account = await Account.deploy();
    await account.waitForDeployment();

    return { subject, token, hook, account, user };
  }

  function buildHookPrefix(tokenAddr: string, recipientAddr: string, minAmount: bigint): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "uint256"],
      [tokenAddr, recipientAddr, minAmount],
    );
  }

  it("sufficient swap output — passes (MEV sandwich + oracle scenarios)", async function () {
    const { subject, token, hook, account, user } = await deploy();

    const hookPrefix = buildHookPrefix(
      await token.getAddress(),
      user.address,
      MIN_AMOUNT,
    );
    const subjectCallData = subject.interface.encodeFunctionData("transferERC20", [
      await token.getAddress(),
      user.address,
      1000n,
    ]);
    const callData = ethers.concat([hookPrefix, subjectCallData]);

    await expect(
      account.executeWithHook(
        await subject.getAddress(),
        callData,
        await hook.getAddress(),
        ENTITY_ID,
      ),
    ).to.not.be.reverted;
  });

  it("insufficient output (sandwiched / manipulated oracle) — reverts", async function () {
    const { subject, token, hook, account, user } = await deploy();

    const hookPrefix = buildHookPrefix(
      await token.getAddress(),
      user.address,
      MIN_AMOUNT,
    );
    const subjectCallData = subject.interface.encodeFunctionData("transferERC20", [
      await token.getAddress(),
      user.address,
      200n,
    ]);
    const callData = ethers.concat([hookPrefix, subjectCallData]);

    await expect(
      account.executeWithHook(
        await subject.getAddress(),
        callData,
        await hook.getAddress(),
        ENTITY_ID,
      ),
    ).to.be.revertedWithCustomError(hook, "InsufficientOutput");
  });
});
