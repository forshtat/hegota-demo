import { expect } from "chai";
import { ethers } from "hardhat";
import {
  deployTestSubject,
  TRANSFER_TOPIC,
} from "../helpers.js";

// ERC-7579 path: same assertion logic as ERC-6900, different account interface.
// TxTraceValidator inherits RequiredEventHook._assertRequiredEvent and exposes
// preCheck / postCheck (IERC7579Hook) instead of preExecutionHook / postExecutionHook.
// Suspended: TXTRACE oracle calls must run in POST_TX frame (EIP-7906 + EthRex PR #6891).
// Policy logic is correct; migrate to frame transactions — see test/frame-assertions/.
describe.skip("ERC-7579 Hook — TxTraceValidator (shared assertion logic)", function () {

  function buildHookPrefix(topic0: string, amount: bigint): string {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256"],
      [topic0, amount],
    );
  }

  async function deploy() {
    const subject = await deployTestSubject();

    const Validator = await ethers.getContractFactory("TxTraceValidator");
    const validator = await Validator.deploy();
    await validator.waitForDeployment();

    const Account = await ethers.getContractFactory("MockERC7579Account");
    const account = await Account.deploy();
    await account.waitForDeployment();

    return { subject, validator, account };
  }

  it("required event present — passes (same logic as ERC-6900)", async function () {
    const { subject, validator, account } = await deploy();

    const amount = 1000n;
    const recipientAddr = ethers.Wallet.createRandom().address;

    const hookPrefix = buildHookPrefix(TRANSFER_TOPIC, amount);
    const subjectCallData = subject.interface.encodeFunctionData("emitTransfer", [
      recipientAddr,
      amount,
    ]);
    const callData = ethers.concat([hookPrefix, subjectCallData]);

    await expect(
      account.executeFromExecutor(
        await subject.getAddress(),
        callData,
        await validator.getAddress(),
      ),
    ).to.not.be.reverted;
  });

  it("required event missing — reverts", async function () {
    const { subject, validator, account } = await deploy();

    const amount = 1000n;
    // Hook expects TRANSFER_TOPIC but subject will only write storage (no event)
    const hookPrefix = buildHookPrefix(TRANSFER_TOPIC, amount);
    const subjectCallData = subject.interface.encodeFunctionData("writeSlot", [
      ethers.zeroPadValue(ethers.toBeHex(7), 32),
      42,
    ]);
    const callData = ethers.concat([hookPrefix, subjectCallData]);

    await expect(
      account.executeFromExecutor(
        await subject.getAddress(),
        callData,
        await validator.getAddress(),
      ),
    ).to.be.revertedWithCustomError(validator, "RequiredEventNotFound");
  });
});
