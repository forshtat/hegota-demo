import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestSubject } from "../helpers.js";

// Suspended: TXTRACE oracle calls must run in POST_TX frame (EIP-7906 + EthRex PR #6891).
// Policy logic is correct; migrate to frame transactions — see test/frame-assertions/.
describe.skip("Gnosis Safe Guards", function () {
  // ─── SlotProtectionGuard ───────────────────────────────────────────────────

  describe("SlotProtectionGuard", function () {
    // Protect slot = bytes32(uint256(0x01))
    const protectedSlot = ethers.zeroPadValue(ethers.toBeHex(1), 32);

    async function deploySlotGuard() {
      const subject = await deployTestSubject();

      const Guard = await ethers.getContractFactory("SlotProtectionGuard");
      const guard = await Guard.deploy([protectedSlot]);
      await guard.waitForDeployment();

      const Safe = await ethers.getContractFactory("MockSafe");
      const safe = await Safe.deploy();
      await safe.waitForDeployment();
      await safe.setGuard(await guard.getAddress());

      return { subject, guard, safe };
    }

    it("writing an unprotected slot passes", async function () {
      const { subject, safe } = await deploySlotGuard();

      const unprotectedSlot = ethers.zeroPadValue(ethers.toBeHex(0x42), 32);
      const callData = subject.interface.encodeFunctionData("writeSlot", [
        unprotectedSlot,
        99,
      ]);

      await expect(
        safe.execTransaction(await subject.getAddress(), 0, callData),
      ).to.not.be.reverted;
    });

    it("writing the protected slot reverts", async function () {
      const { subject, safe, guard } = await deploySlotGuard();

      const callData = subject.interface.encodeFunctionData("writeSlot", [
        protectedSlot,
        99,
      ]);

      await expect(
        safe.execTransaction(await subject.getAddress(), 0, callData),
      ).to.be.revertedWithCustomError(guard, "ProtectedSlotModified");
    });
  });

  // ─── NoDeployGuard ─────────────────────────────────────────────────────────

  describe("NoDeployGuard", function () {
    async function deployNoDeployGuard() {
      const subject = await deployTestSubject();

      const Guard = await ethers.getContractFactory("NoDeployGuard");
      const guard = await Guard.deploy();
      await guard.waitForDeployment();

      const Safe = await ethers.getContractFactory("MockSafe");
      const safe = await Safe.deploy();
      await safe.waitForDeployment();
      await safe.setGuard(await guard.getAddress());

      return { subject, guard, safe };
    }

    it("transaction without deployment passes", async function () {
      const { subject, safe } = await deployNoDeployGuard();

      const callData = subject.interface.encodeFunctionData("writeSlot", [
        ethers.zeroPadValue(ethers.toBeHex(5), 32),
        42,
      ]);

      await expect(
        safe.execTransaction(await subject.getAddress(), 0, callData),
      ).to.not.be.reverted;
    });

    it("transaction deploying a contract reverts", async function () {
      const { subject, safe, guard } = await deployNoDeployGuard();

      const callData = subject.interface.encodeFunctionData("deployContract");

      await expect(
        safe.execTransaction(await subject.getAddress(), 0, callData),
      ).to.be.revertedWithCustomError(guard, "UnauthorizedContractDeployment");
    });
  });
});
