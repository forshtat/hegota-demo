#!/usr/bin/env node
// Live verification (scoped, one-off -- not part of any main deploy flow).
//
// Confirms, against the real Hegotá devnet:
//   1. A stub Safe can be provisioned for a fresh test owner via the real SafeProxyFactory +
//      MinimalSafeStub singleton (the exact deployment shape frontend/src/hegotaSafeAccount.ts
//      already drives), and getOwners()/getThreshold() read back correctly.
//   2. threshold really lives at storage slot 4 (read directly via eth_getStorageAt).
//   3. setGuard (self-authorized) really writes the guard address at GuardManager's exact
//      hashed slot.
//   4. The load-bearing one: a real signed execTransaction with operation=1 (delegatecall)
//      to TestSubject.writeSlot(...) changes the STUB PROXY's own storage, not TestSubject's --
//      genuine delegatecall semantics, not just "the call succeeded". Contrasted against
//      operation=0 (call), which changes TestSubject's storage instead, proving real dispatch
//      differentiation rather than both operations behaving the same way.
//
// Usage: node scripts/verify-hegota-safe-stub.mjs

import "dotenv/config";
import {
  JsonRpcProvider, Wallet, Interface, Contract, ZeroAddress,
  zeroPadValue, toBeHex, keccak256, AbiCoder,
} from "ethers";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function artifact(fullPath) {
  return JSON.parse(readFileSync(fullPath, "utf8"));
}

const MinimalSafeStub = artifact(path.join(ROOT, "artifacts/contracts/hegota/MinimalSafeStub.sol/MinimalSafeStub.json"));
const SafeProxyFactory = artifact(path.join(
  ROOT, "node_modules/@safe-global/safe-contracts/build/artifacts/contracts/proxies/SafeProxyFactory.sol/SafeProxyFactory.json",
));
const TestSubjectABI = artifact(path.join(ROOT, "artifacts/contracts/shared/TestSubject.sol/TestSubject.json")).abi;

const GUARD_STORAGE_SLOT = "0x4a204f620c8c5ccdca3fd54d003badd85ba500436a431f0cbda4f558c93c34c8";

async function main() {
  const rpcUrl = process.env.HEGOTA_RPC_URL ?? "https://rpc1.hegota.ethrex.xyz";
  const relayPk = process.env.HEGOTA_PRIVATE_KEY;
  if (!relayPk) throw new Error("HEGOTA_PRIVATE_KEY not set in .env");

  const singletonAddr = process.env.VITE_HEGOTA_SAFE_SINGLETON
    ?? extractEnv("VITE_HEGOTA_SAFE_SINGLETON");
  const proxyFactoryAddr = process.env.VITE_HEGOTA_SAFE_PROXY_FACTORY
    ?? extractEnv("VITE_HEGOTA_SAFE_PROXY_FACTORY");
  const testSubjectAddr = process.env.VITE_HEGOTA_TEST_SUBJECT
    ?? extractEnv("VITE_HEGOTA_TEST_SUBJECT");

  console.log(`Singleton (stub):    ${singletonAddr}`);
  console.log(`SafeProxyFactory:    ${proxyFactoryAddr}`);
  console.log(`TestSubject (target):${testSubjectAddr}`);

  const provider = new JsonRpcProvider(rpcUrl);
  const relay = new Wallet(relayPk, provider);

  // Fresh test owner -- never needs to hold Hegotá ETH; execTransaction is broadcast by the
  // relay key, matching how the real Safe is normally relayed.
  const testOwner = Wallet.createRandom();
  console.log(`\nTest owner (fresh):  ${testOwner.address}`);

  const stubIface = new Interface(MinimalSafeStub.abi);
  const proxyFactoryIface = new Interface(SafeProxyFactory.abi);
  const abiCoder = AbiCoder.defaultAbiCoder();

  // ── Step 1: provision a stub Safe for the test owner ─────────────────────────────
  const setupData = stubIface.encodeFunctionData("setup", [
    [testOwner.address], 1, ZeroAddress, "0x", ZeroAddress, ZeroAddress, 0, ZeroAddress,
  ]);
  const saltNonce = BigInt(keccak256(abiCoder.encode(["address"], [testOwner.address])));

  const proxyFactory = new Contract(proxyFactoryAddr, SafeProxyFactory.abi, relay);
  console.log("\nProvisioning stub Safe via createProxyWithNonce...");
  const tx = await proxyFactory.createProxyWithNonce(singletonAddr, setupData, saltNonce);
  const receipt = await tx.wait();
  const proxyCreationTopic = keccak256(Buffer.from("ProxyCreation(address,address)"));
  const log = receipt.logs.find((l) => l.topics[0] === proxyCreationTopic);
  if (!log) throw new Error("ProxyCreation event not found");
  const safeAddr = "0x" + log.topics[1].slice(26);
  console.log(`Stub Safe deployed:  ${safeAddr}  (tx ${tx.hash})`);

  // Two bindings to the same contract: `safeRead` (plain provider, no `from`) for view
  // calls -- Hegotá's eth_call rejects a signer-attached `from` with a mismatched pending
  // nonce for pure `eth_call`s, a node quirk unrelated to this task -- and `safe` (relay
  // signer) exclusively for the state-changing execTransaction/nonce() calls below.
  const safeRead = new Contract(safeAddr, MinimalSafeStub.abi, provider);
  const safe = new Contract(safeAddr, MinimalSafeStub.abi, relay);

  // ── Step 2: getOwners()/getThreshold() read back correctly ───────────────────────
  const owners = await safeRead.getOwners();
  const threshold = await safeRead.getThreshold();
  console.log(`\ngetOwners():    ${owners}`);
  console.log(`getThreshold(): ${threshold}`);
  assert(owners.length === 1 && owners[0].toLowerCase() === testOwner.address.toLowerCase(), "getOwners() mismatch");
  assert(threshold === 1n, "getThreshold() mismatch");

  // ── Step 3: threshold really lives at storage slot 4 ─────────────────────────────
  const slot4Raw = await provider.getStorage(safeAddr, 4);
  console.log(`\neth_getStorageAt(safe, 4) = ${slot4Raw}`);
  assert(BigInt(slot4Raw) === 1n, "slot 4 is not threshold==1");
  console.log("CONFIRMED: threshold lives at storage slot 4.");

  // ── Step 4: setGuard writes the guard address at GuardManager's exact hashed slot ─
  const fakeGuard = Wallet.createRandom().address;
  await execSafeTx(safe, testOwner, safeAddr, 0n, stubIface.encodeFunctionData("setGuard", [fakeGuard]), 0);
  const guardSlotRaw = await provider.getStorage(safeAddr, GUARD_STORAGE_SLOT);
  console.log(`\neth_getStorageAt(safe, GUARD_STORAGE_SLOT) = ${guardSlotRaw}`);
  assert(guardSlotRaw.toLowerCase() === zeroPadValue(fakeGuard, 32).toLowerCase(), "guard slot mismatch");
  console.log("CONFIRMED: setGuard writes to GuardManager's exact hashed slot.");

  // ── Step 5: the load-bearing check -- CALL vs DELEGATECALL dispatch ─────────────
  const testSubjectIface = new Interface(TestSubjectABI);

  // Mapping storage formula: slots[key] lives at keccak256(abi.encode(key, baseSlot)).
  // TestSubject.slots is its (and, when delegatecalled, the Safe stub's) storage slot 0.
  function mappingSlot(key) {
    return keccak256(abiCoder.encode(["bytes32", "uint256"], [key, 0]));
  }

  // -- operation=0 (CALL): TestSubject's OWN storage should change; the Safe's should not.
  const callKey = keccak256(Buffer.from("call-dispatch-probe"));
  const callSlot = mappingSlot(callKey);
  const callValue = 111n;
  await execSafeTx(
    safe, testOwner, testSubjectAddr, 0n,
    testSubjectIface.encodeFunctionData("writeSlot", [callKey, callValue]), 0,
  );
  const callTargetStorage = BigInt(await provider.getStorage(testSubjectAddr, callSlot));
  const callSafeStorage = BigInt(await provider.getStorage(safeAddr, callSlot));
  console.log(`\n[operation=0 CALL] TestSubject.slots[key] = ${callTargetStorage} (expect ${callValue})`);
  console.log(`[operation=0 CALL] Safe's storage at same slot = ${callSafeStorage} (expect 0)`);
  assert(callTargetStorage === callValue, "CALL did not write TestSubject's storage");
  assert(callSafeStorage === 0n, "CALL unexpectedly wrote the Safe's own storage");

  // -- operation=1 (DELEGATECALL): the Safe's OWN storage should change; TestSubject's should not.
  const dcallKey = keccak256(Buffer.from("delegatecall-dispatch-probe"));
  const dcallSlot = mappingSlot(dcallKey);
  const dcallValue = 222n;
  await execSafeTx(
    safe, testOwner, testSubjectAddr, 0n,
    testSubjectIface.encodeFunctionData("writeSlot", [dcallKey, dcallValue]), 1,
  );
  const dcallTargetStorage = BigInt(await provider.getStorage(testSubjectAddr, dcallSlot));
  const dcallSafeStorage = BigInt(await provider.getStorage(safeAddr, dcallSlot));
  console.log(`\n[operation=1 DELEGATECALL] TestSubject.slots[key] = ${dcallTargetStorage} (expect 0)`);
  console.log(`[operation=1 DELEGATECALL] Safe's storage at same slot = ${dcallSafeStorage} (expect ${dcallValue})`);
  assert(dcallTargetStorage === 0n, "DELEGATECALL unexpectedly wrote TestSubject's real storage");
  assert(dcallSafeStorage === dcallValue, "DELEGATECALL did not write the Safe's own storage");

  console.log("\nCONFIRMED: operation=0 dispatches via real CALL (writes the target's storage);");
  console.log("           operation=1 dispatches via real DELEGATECALL (writes the Safe's own storage).");
  console.log("\nAll live checks passed.");
}

async function execSafeTx(safeContract, ownerWallet, to, value, data, operation) {
  const safeAddress = await safeContract.getAddress();
  const provider = safeContract.runner.provider;
  const chainId = (await provider.getNetwork()).chainId;
  // Read via a plain-provider binding (no `from`) -- see the comment in main() about
  // Hegotá's eth_call quirk with a signer-attached `from` and a mismatched pending nonce.
  const safeRead = new Contract(safeAddress, MinimalSafeStub.abi, provider);
  const nonce = await safeRead.nonce();

  const sig = await ownerWallet.signTypedData(
    { chainId, verifyingContract: safeAddress },
    { SafeTx: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "operation", type: "uint8" },
      { name: "safeTxGas", type: "uint256" },
      { name: "baseGas", type: "uint256" },
      { name: "gasPrice", type: "uint256" },
      { name: "gasToken", type: "address" },
      { name: "refundReceiver", type: "address" },
      { name: "nonce", type: "uint256" },
    ] },
    { to, value, data, operation, safeTxGas: 0n, baseGas: 0n,
      gasPrice: 0n, gasToken: ZeroAddress, refundReceiver: ZeroAddress, nonce },
  );

  const tx = await safeContract.execTransaction(
    to, value, data, operation, 0, 0, 0, ZeroAddress, ZeroAddress, sig,
  );
  return tx.wait();
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function extractEnv(key) {
  const content = readFileSync(path.join(ROOT, "frontend/.env"), "utf8");
  const match = content.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) throw new Error(`${key} not found in frontend/.env`);
  return match[1].trim();
}

main().catch((e) => { console.error(e); process.exit(1); });
