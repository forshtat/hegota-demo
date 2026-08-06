// A real, per-user Gnosis Safe (1-of-1, owned solely by the connected wallet).
//
// Mirrors erc7579Account.ts's shape/conventions closely: the Safe is deployed by the relay
// key on behalf of whichever address is connected -- a sponsored, one-time setup step the
// connected wallet never has to pay for or sign -- and its address is deterministic per
// owner (CREATE2 via SafeProxyFactory), so a returning visitor's Safe is stable across
// sessions. Uses the exact same @safe-global/safe-contracts Safe singleton + SafeProxyFactory
// artifacts, and the exact setup(...) call shape, that scripts/demo.mjs's deploySafe() helper
// already uses to deploy per-scenario Safes on the local EthRex chain -- just parameterized
// by a real end-user's owner address instead of the demo's own DemoExecutor, and without the
// SudoModule-enabling step (that's local-demo reset infra with no equivalent on Hegotá).
//
// Unlike predictAccountAddress (which calls the ERC-7579 factory's own getAddress() view
// function on-chain), SafeProxyFactory has no such convenience view -- so the CREATE2 address
// is computed here directly from the well-known formula in SafeProxyFactory.sol's
// createProxyWithNonce/deployProxy: the init code is SafeProxy's own creation code with the
// singleton address appended as its constructor argument, and the salt is
// keccak256(keccak256(initializer) ++ saltNonce).

import {
  AbiCoder,
  Interface,
  ZeroAddress,
  concat,
  getBytes,
  getCreate2Address,
  keccak256,
  toBeHex,
  zeroPadValue,
  type BrowserProvider,
  type JsonRpcSigner,
} from "ethers";
import { SafeSingletonABI, SafeProxyFactoryABI, SafeProxyCreationCode } from "./contracts/abis.js";
import { connectRelayWallet, lowFeeOverrides } from "./hegotaWallet.js";

export const HEGOTA_SAFE_SINGLETON = import.meta.env.VITE_HEGOTA_SAFE_SINGLETON ?? "";
export const HEGOTA_SAFE_PROXY_FACTORY = import.meta.env.VITE_HEGOTA_SAFE_PROXY_FACTORY ?? "";

export function isSafeConfigured(): boolean {
  return Boolean(HEGOTA_SAFE_SINGLETON && HEGOTA_SAFE_PROXY_FACTORY);
}

const safeIface = new Interface(SafeSingletonABI);
const proxyFactoryIface = new Interface(SafeProxyFactoryABI);
const abiCoder = AbiCoder.defaultAbiCoder();

/** The exact setup(...) call shape scripts/demo.mjs's deploySafe() helper uses: a 1-of-1
 *  Safe owned solely by `owner`, no fallback handler/payment/module wiring. */
function buildSetupData(owner: string): string {
  return safeIface.encodeFunctionData("setup", [
    [owner],
    1,
    ZeroAddress,
    "0x",
    ZeroAddress,
    ZeroAddress,
    0,
    ZeroAddress,
  ]);
}

/** Deterministic per-owner saltNonce, mirroring erc7579Account's CREATE2 salt derivation
 *  (MinimalERC7579AccountFactory._salt: keccak256(abi.encode(owner))) -- even though the
 *  setup calldata above already bakes owner into the initializer (and thus into the salt
 *  SafeProxyFactory itself hashes), deriving saltNonce from owner too keeps this address
 *  deterministic-by-construction rather than as an incidental side effect. */
function ownerSaltNonce(owner: string): bigint {
  return BigInt(keccak256(abiCoder.encode(["address"], [owner])));
}

/** CREATE2 address for the proxy SafeProxyFactory.createProxyWithNonce would deploy, computed
 *  the same way SafeProxyFactory.deployProxy does on-chain:
 *    initCode     = type(SafeProxy).creationCode ++ uint256(uint160(singleton))
 *    salt         = keccak256(keccak256(initializer) ++ saltNonce)
 *    proxyAddress = CREATE2(factory, salt, keccak256(initCode))
 */
export async function predictSafeAddress(_provider: BrowserProvider, owner: string): Promise<string> {
  const setupData = buildSetupData(owner);
  const saltNonce = ownerSaltNonce(owner);

  const initCode = concat([SafeProxyCreationCode, zeroPadValue(HEGOTA_SAFE_SINGLETON, 32)]);
  const initCodeHash = keccak256(initCode);
  const salt = keccak256(concat([keccak256(getBytes(setupData)), toBeHex(saltNonce, 32)]));

  return getCreate2Address(HEGOTA_SAFE_PROXY_FACTORY, salt, initCodeHash);
}

export async function isSafeDeployed(provider: BrowserProvider, safeAddress: string): Promise<boolean> {
  const code = await provider.getCode(safeAddress);
  return code !== "0x";
}

/** Sponsored provisioning: the relay key deploys a 1-of-1 Safe owned solely by `owner`,
 *  who never needs to hold Hegotá ETH to pay for this step. The connected wallet still
 *  signs a plain personal_sign confirmation first -- decorative only, not checked
 *  on-chain, purely so the user sees and feels a wallet prompt for the action they took. */
export async function provisionSafe(
  provider: BrowserProvider,
  signer: JsonRpcSigner,
  owner: string,
): Promise<{ address: string; txHash: string }> {
  await signer.signMessage(`Deploy my personal Hegotá demo Safe\nowner: ${owner}`);
  const relay = connectRelayWallet(provider);
  const setupData = buildSetupData(owner);
  const saltNonce = ownerSaltNonce(owner);

  const data = proxyFactoryIface.encodeFunctionData("createProxyWithNonce", [
    HEGOTA_SAFE_SINGLETON,
    setupData,
    saltNonce,
  ]);
  const tx = await relay.sendTransaction({ to: HEGOTA_SAFE_PROXY_FACTORY, data, ...(await lowFeeOverrides(provider)) });
  await tx.wait();

  const address = await predictSafeAddress(provider, owner);
  return { address, txHash: tx.hash };
}
