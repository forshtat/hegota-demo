import { expect } from "chai";
import { ethers } from "hardhat";
import {
  deployTestSubject,
  TRANSFER_TOPIC,
} from "../helpers.js";

// Suspended: TXTRACE oracle calls must run in POST_TX frame (EIP-7906 + EthRex PR #6891).
// Policy logic is correct; migrate to frame transactions — see test/frame-assertions/.
describe.skip("ERC-6900 Execution Hooks — RequiredEventHook", function () {
  const ENTITY_ID = 1;

  // hookData passed to preExecutionHook calldata (first 64 bytes of callData):
  //   bytes32 requiredTopic0 ++ uint256 requiredAmount
  function buildHookPrefix(topic0: string, amount: bigint): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256"],
      [topic0, amount],
    );
  }

  async function deploy() {
    const subject = await deployTestSubject();

    const Hook = await ethers.getContractFactory("RequiredEventHook");
    const hook = await Hook.deploy();
    await hook.waitForDeployment();

    const Account = await ethers.getContractFactory("MockModularAccount");
    const account = await Account.deploy();
    await account.waitForDeployment();

    return { subject, hook, account };
  }

  it("required event present — passes", async function () {
    const { subject, hook, account } = await deploy();

    const transferAmount = 1000n;
    const recipientAddr = ethers.Wallet.createRandom().address;

    // callData = [64 bytes hookPrefix][subject calldata]
    // preExecutionHook slices callData[:64] to get the assertion terms
    const hookPrefix = buildHookPrefix(TRANSFER_TOPIC, transferAmount);
    const subjectCallData = subject.interface.encodeFunctionData("emitTransfer", [
      recipientAddr,
      transferAmount,
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

  it("wrong topic — reverts", async function () {
    const { subject, hook, account } = await deploy();

    const transferAmount = 1000n;
    const wrongTopic = ethers.zeroPadValue(ethers.toBeHex(0xdead), 32);
    const recipientAddr = ethers.Wallet.createRandom().address;

    const hookPrefix = buildHookPrefix(wrongTopic, transferAmount);
    const subjectCallData = subject.interface.encodeFunctionData("emitTransfer", [
      recipientAddr,
      transferAmount,
    ]);
    const callData = ethers.concat([hookPrefix, subjectCallData]);

    await expect(
      account.executeWithHook(
        await subject.getAddress(),
        callData,
        await hook.getAddress(),
        ENTITY_ID,
      ),
    ).to.be.revertedWithCustomError(hook, "RequiredEventNotFound");
  });
});
