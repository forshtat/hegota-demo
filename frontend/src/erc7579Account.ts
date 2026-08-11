// A real ERC-7579 smart account owned by the connected MetaMask key.
//
// The account is deployed (and its validator + executor modules installed) by the
// relay key on behalf of whichever address is connected — a sponsored, one-time setup
// step the connected wallet never has to pay for or sign. Its address is deterministic
// per owner (CREATE2), so a returning visitor's account is stable across sessions.
// See contracts/erc7579/MinimalERC7579Account.sol, OwnerEcdsaValidator.sol, and
// PostTxExecutor.sol for the on-chain side.

import { Interface, getBytes, type BrowserProvider, type JsonRpcSigner } from "ethers";
import {
  MinimalERC7579AccountProxyFactoryABI,
  MinimalERC7579AccountABI,
  PostTxExecutorABI,
} from "./contracts/abis.js";
import { connectRelayWallet, lowFeeOverrides, type FrameTxPlan } from "./hegotaWallet.js";
import { Frame, FrameMode } from "./frametx.js";
import { fetchSelfVerifyNonce, registerKnownInterface } from "./frameSigning.js";
import { claimHegotaFaucet, waitForNonZeroBalance } from "./hegotaFaucet.js";

// Routes an EIP-8141 VERIFY(self) frame to MinimalERC7579Account's fallback rather than its
// receive() (which stays reserved for plain ETH transfers, e.g. faucet claims/IN_TOKEN mints):
// Solidity dispatches empty-calldata calls to receive() when one exists, so this frame's data
// must be non-empty. Its actual byte value is never read on-chain -- the account's fallback
// always uses its own trusted, embedded owner (see MinimalERC7579AccountProxy.yul), ignoring
// calldata entirely.
export const SELF_VERIFY_SENTINEL = Uint8Array.of(0x01);

// The account deployed for each owner is a tiny MinimalERC7579AccountProxy (CREATE2'd by
// HEGOTA_ERC7579_FACTORY) delegatecalling this fixed, shared MinimalERC7579Account
// implementation -- see that contract's own doc comment for why: EIP-8141's
// MAX_VERIFY_GAS budget for a self-funded `deploy+self_verify` transaction (the account
// paying for its own deployment) can only ever afford a proxy-sized deploy, never the full
// implementation's runtime.
export const HEGOTA_ERC7579_FACTORY = import.meta.env.VITE_HEGOTA_ERC7579_FACTORY ?? "";
export const HEGOTA_ERC7579_IMPLEMENTATION = import.meta.env.VITE_HEGOTA_ERC7579_IMPLEMENTATION ?? "";
export const HEGOTA_OWNER_VALIDATOR = import.meta.env.VITE_HEGOTA_OWNER_VALIDATOR ?? "";
export const HEGOTA_POST_TX_EXECUTOR = import.meta.env.VITE_HEGOTA_POST_TX_EXECUTOR ?? "";

export function isErc7579Configured(): boolean {
  return Boolean(HEGOTA_ERC7579_FACTORY && HEGOTA_ERC7579_IMPLEMENTATION && HEGOTA_OWNER_VALIDATOR && HEGOTA_POST_TX_EXECUTOR);
}

const factoryIface = new Interface(MinimalERC7579AccountProxyFactoryABI);
const accountIface = new Interface(MinimalERC7579AccountABI);
const executorIface = new Interface(PostTxExecutorABI);
// So the wallet-simulator drawer's device screens (ProvisioningPanel.tsx) can decode
// createAccount/completeSetup calls by name+args instead of showing raw hex.
registerKnownInterface(factoryIface);
registerKnownInterface(accountIface);

export async function predictAccountAddress(provider: BrowserProvider, owner: string): Promise<string> {
  const data = factoryIface.encodeFunctionData("getAddress", [owner]);
  const result = await provider.call({ to: HEGOTA_ERC7579_FACTORY, data });
  return factoryIface.decodeFunctionResult("getAddress", result)[0] as string;
}

export async function isAccountDeployed(provider: BrowserProvider, account: string): Promise<boolean> {
  const code = await provider.getCode(account);
  return code !== "0x";
}

/** Sponsored provisioning (real wallets): the relay key deploys the proxy and calls
 *  completeSetup(), `owner` never needs to hold Hegotá ETH. Two plain transactions -- deploy,
 *  then completeSetup() to install the validator/executor into the proxy's own storage (see
 *  MinimalERC7579Account.sol's own doc comment for why that's a separate step). The connected
 *  wallet still signs a plain personal_sign confirmation first -- purely so the user sees and
 *  feels a wallet prompt for the action they just took; it isn't checked on-chain, the same
 *  decorative-signature pattern as demoSmartAccountAction.ts. */
export async function provisionAccount(
  provider: BrowserProvider,
  signer: JsonRpcSigner,
  owner: string,
): Promise<{ address: string; txHash: string }> {
  const createData = factoryIface.encodeFunctionData("createAccount", [owner]);
  const completeSetupData = accountIface.encodeFunctionData("completeSetup", []);

  await signer.signMessage(`Deploy my Hegotá demo smart account\nowner: ${owner}`);
  const relay = connectRelayWallet(provider);
  const fees = await lowFeeOverrides(provider);
  const createTx = await relay.sendTransaction({ to: HEGOTA_ERC7579_FACTORY, data: createData, ...fees });
  await createTx.wait();
  const address = await predictAccountAddress(provider, owner);
  const setupTx = await relay.sendTransaction({ to: address, data: completeSetupData, ...fees });
  await setupTx.wait();
  return { address, txHash: setupTx.hash };
}

/** Self-funded provisioning (Demo Wallet): prepares the FrameTxPlan for a single genuine
 *  EIP-8141 `deploy+self_verify` frame transaction whose `sender` is the account's own
 *  predicted CREATE2 address, not `owner`'s EOA -- the account pays for its own deployment.
 *  Submission itself is left to the caller (ProvisioningPanel.tsx), which shows this plan on
 *  its device screens and only signs/sends it once the user clicks Submit there.
 *
 *  Frame 0 (DEFAULT, in the validation prefix, tightly gas-budgeted) calls the factory, which
 *  CREATE2s the tiny proxy at exactly the predicted address. Frame 1 (VERIFY, self, also in
 *  the prefix) then runs the just-deployed proxy's fallback (delegated to the shared
 *  implementation, see SelfVerifyLib.sol), which checks the outer envelope signature's
 *  resolved signer against the proxy's own embedded owner and approves execution+payment if
 *  it matches. Frame 2 (DEFAULT, outside the prefix, no gas cap) then calls completeSetup(),
 *  now unconstrained. The envelope is signed by `owner`'s own EOA key -- that's exactly the
 *  signature the fallback checks -- so the account can be `sender` even though it holds no
 *  private key of its own. The faucet funds the predicted address directly, before it has any
 *  code, so it can pay its own gas for both the deploy and the completeSetup call. */
export async function prepareProvisionAccount(
  provider: BrowserProvider,
  owner: string,
  reportProgress: (label: string) => Promise<void>,
): Promise<{ plan: FrameTxPlan; signerAddress: string }> {
  const accountAddress = await predictAccountAddress(provider, owner);

  await reportProgress("Claiming Hegotá ETH from the public faucet");
  await claimHegotaFaucet(accountAddress);
  await reportProgress("Waiting for the claim to land on-chain");
  await waitForNonZeroBalance(provider, accountAddress);
  await reportProgress("Building the deployment transaction");

  const createData = factoryIface.encodeFunctionData("createAccount", [owner]);
  const completeSetupData = accountIface.encodeFunctionData("completeSetup", []);
  const nonceSeq = await fetchSelfVerifyNonce(provider, accountAddress);
  const plan: FrameTxPlan = {
    sender: accountAddress,
    nonceKeys: [0],
    nonceSeq,
    frames: [
      // Live-measured real usage: deploy ~117k, verify ~6.7k, completeSetup ~344k -- these
      // limits keep a comfortable margin (prefix total 220k, well under the devnet's
      // MAX_VERIFY_GAS=500k; completeSetup is outside the prefix so isn't budget-constrained
      // at all, but still gets a real limit rather than an arbitrarily huge one).
      new Frame(FrameMode.DEFAULT, 0, HEGOTA_ERC7579_FACTORY, 200_000, 0, getBytes(createData)),
      new Frame(FrameMode.VERIFY, 0x03, accountAddress, 20_000, 0, SELF_VERIFY_SENTINEL),
      new Frame(FrameMode.DEFAULT, 0, accountAddress, 500_000, 0, getBytes(completeSetupData)),
    ],
  };
  return { plan, signerAddress: owner };
}

/** The account's current nonce at PostTxExecutor, needed to build the EIP-712 value
 *  that must match what nextActionHash() derived for signing. */
export async function currentNonce(provider: BrowserProvider, account: string): Promise<bigint> {
  const data = executorIface.encodeFunctionData("nonces", [account]);
  const result = await provider.call({ to: HEGOTA_POST_TX_EXECUTOR, data });
  return executorIface.decodeFunctionResult("nonces", result)[0] as bigint;
}

/** The exact EIP-712 digest that must be signed to authorize the next action for
 *  `account` — computed on-chain so the frontend never has to reproduce the domain
 *  separator itself (see contracts/erc7579/PostTxExecutor.sol's _actionHash). */
export async function nextActionHash(
  provider: BrowserProvider,
  account: string,
  target: string,
  callData: string,
): Promise<string> {
  const data = executorIface.encodeFunctionData("nextActionHash", [account, target, callData]);
  const result = await provider.call({ to: HEGOTA_POST_TX_EXECUTOR, data });
  return executorIface.decodeFunctionResult("nextActionHash", result)[0] as string;
}

/** Calldata for the frame tx's DEFAULT frame when routing through the smart account:
 *  PostTxExecutor.executeAction(account, validator, target, callData, signature). */
export function encodeExecuteAction(
  account: string,
  target: string,
  callData: string,
  signature: string,
): string {
  return executorIface.encodeFunctionData("executeAction", [
    account,
    HEGOTA_OWNER_VALIDATOR,
    target,
    callData,
    signature,
  ]);
}
