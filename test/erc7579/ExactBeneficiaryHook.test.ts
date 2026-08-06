import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestSubject } from "../helpers.js";

// Threat 3: Hidden Side-Effect Detection (Multicall / Hidden ETH Drain)
//
// A transaction claims to send ETH to a legitimate address but secretly also
// sends ETH to an attacker (e.g., via a hidden call or multicall leg). The wallet
// UI shows only the intended transfer; the attacker drain is invisible at signing time.
//
// ExactBeneficiaryHook detects this by scanning TXTRACE balance changes after execution:
// any address whose balance increased that is NOT the declared allowed recipient → revert.
//
// Gas-fee safety: gas charges always DECREASE balances, so the tx payer never
// triggers a false positive in this check.

// Suspended: TXTRACE oracle calls must run in POST_TX frame (EIP-7906 + EthRex PR #6891).
// Policy logic is correct; migrate to frame transactions — see test/frame-assertions/.
describe.skip("ERC-7579 Hook — ExactBeneficiaryHook (hidden ETH drain prevention)", function () {

  async function deploy() {
    const subject = await deployTestSubject();

    const Hook = await ethers.getContractFactory("ExactBeneficiaryHook");
    const hook = await Hook.deploy();
    await hook.waitForDeployment();

    const Account = await ethers.getContractFactory("MockERC7579Account");
    const account = await Account.deploy();
    await account.waitForDeployment();

    return { subject, hook, account };
  }

  it("ETH only to declared recipient — passes", async function () {
    const { subject, hook, account } = await deploy();

    const legitimateRecipient = ethers.Wallet.createRandom().address;

    // hookPrefix = abi.encode(address allowedRecipient) = 32 bytes
    const hookPrefix = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address"],
      [legitimateRecipient],
    );
    const subjectCallData = subject.interface.encodeFunctionData("sendEth", [
      legitimateRecipient,
      ethers.parseEther("0.5"),
    ]);
    const callData = ethers.concat([hookPrefix, subjectCallData]);

    await expect(
      account.executeFromExecutor(
        await subject.getAddress(),
        callData,
        await hook.getAddress(),
        { value: ethers.parseEther("0.5") },
      ),
    ).to.not.be.reverted;
  });

  it("hidden ETH drain to attacker — reverts", async function () {
    const { subject, hook, account } = await deploy();

    const legitimateRecipient = ethers.Wallet.createRandom().address;
    const attackerAddress = ethers.Wallet.createRandom().address;

    const hookPrefix = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address"],
      [legitimateRecipient],
    );
    // sendEthToTwo sends to BOTH legitimate and attacker — attacker is hidden from the user
    const subjectCallData = subject.interface.encodeFunctionData("sendEthToTwo", [
      legitimateRecipient,
      ethers.parseEther("0.25"),
      attackerAddress,
      ethers.parseEther("0.25"),
    ]);
    const callData = ethers.concat([hookPrefix, subjectCallData]);

    await expect(
      account.executeFromExecutor(
        await subject.getAddress(),
        callData,
        await hook.getAddress(),
        { value: ethers.parseEther("0.5") },
      ),
    ).to.be.revertedWithCustomError(hook, "UnexpectedRecipient");
  });
});
