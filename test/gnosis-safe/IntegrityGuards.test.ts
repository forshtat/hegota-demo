import { expect } from "chai";
import { ethers } from "hardhat";
import { deployTestSubject } from "../helpers.js";

// Suspended: TXTRACE oracle calls must run in POST_TX frame (EIP-7906 + EthRex PR #6891).
// Policy logic is correct; migrate to frame transactions — see test/frame-assertions/.
describe.skip("Gnosis Safe Integrity Guards", function () {

  // ─── SafeIntegrityGuard (Threat 2: Multisig Control-Plane Takeover) ──────────
  // A transaction that appears to be a routine action secretly calls changeThreshold
  // on the Safe itself. SafeIntegrityGuard detects any write to the Safe's own
  // control-plane storage slots (guard=slot0, threshold=slot1).

  describe("SafeIntegrityGuard", function () {
    async function deploy() {
      const subject = await deployTestSubject();

      const Safe = await ethers.getContractFactory("MockSafe");
      const safe = await Safe.deploy();
      await safe.waitForDeployment();

      const Guard = await ethers.getContractFactory("SafeIntegrityGuard");
      const guard = await Guard.deploy(await safe.getAddress());
      await guard.waitForDeployment();
      await safe.setGuard(await guard.getAddress());

      return { subject, safe, guard };
    }

    it("unrelated storage write — passes", async function () {
      const { subject, safe } = await deploy();

      const callData = subject.interface.encodeFunctionData("writeSlot", [
        ethers.zeroPadValue(ethers.toBeHex(0x42), 32),
        99,
      ]);

      await expect(
        safe.execTransaction(await subject.getAddress(), 0, callData),
      ).to.not.be.reverted;
    });

    it("Safe threshold modification — reverts", async function () {
      const { safe, guard } = await deploy();

      // Target is the Safe itself — simulates a control-plane takeover hidden in a tx
      const callData = safe.interface.encodeFunctionData("changeThreshold", [1]);

      await expect(
        safe.execTransaction(await safe.getAddress(), 0, callData),
      ).to.be.revertedWithCustomError(guard, "SafeControlPlaneModified");
    });
  });

  // ─── ProxyIntegrityGuard (Threat 6: Proxy Implementation Swap) ──────────────
  // Between simulation and execution the proxy's implementation is changed. Or a tx
  // secretly upgrades a proxy mid-execution. ProxyIntegrityGuard detects any write
  // to the EIP-1967 canonical implementation slot on any contract in the tx.

  describe("ProxyIntegrityGuard", function () {
    async function deploy() {
      const subject = await deployTestSubject();
      const initialImpl = ethers.Wallet.createRandom().address;

      const Proxy = await ethers.getContractFactory("MockProxy");
      const proxy = await Proxy.deploy(initialImpl);
      await proxy.waitForDeployment();

      const Safe = await ethers.getContractFactory("MockSafe");
      const safe = await Safe.deploy();
      await safe.waitForDeployment();

      const Guard = await ethers.getContractFactory("ProxyIntegrityGuard");
      const guard = await Guard.deploy();
      await guard.waitForDeployment();
      await safe.setGuard(await guard.getAddress());

      return { subject, proxy, safe, guard };
    }

    it("unrelated storage write — passes", async function () {
      const { subject, safe } = await deploy();

      const callData = subject.interface.encodeFunctionData("writeSlot", [
        ethers.zeroPadValue(ethers.toBeHex(0x77), 32),
        1,
      ]);

      await expect(
        safe.execTransaction(await subject.getAddress(), 0, callData),
      ).to.not.be.reverted;
    });

    it("proxy implementation swap — reverts", async function () {
      const { proxy, safe, guard } = await deploy();

      const attackerImpl = ethers.Wallet.createRandom().address;
      const callData = proxy.interface.encodeFunctionData("setImplementation", [attackerImpl]);

      await expect(
        safe.execTransaction(await proxy.getAddress(), 0, callData),
      ).to.be.revertedWithCustomError(guard, "ProxyImplementationChanged");
    });
  });
});
