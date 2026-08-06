// A real ERC-7579 smart account owned by the connected MetaMask key.
//
// The account is deployed (and its validator + executor modules installed) by the
// relay key on behalf of whichever address is connected — a sponsored, one-time setup
// step the connected wallet never has to pay for or sign. Its address is deterministic
// per owner (CREATE2), so a returning visitor's account is stable across sessions.
// See contracts/erc7579/MinimalERC7579Account.sol, OwnerEcdsaValidator.sol, and
// PostTxExecutor.sol for the on-chain side.

import { Interface, type BrowserProvider, type JsonRpcSigner } from "ethers";
import {
  MinimalERC7579AccountFactoryABI,
  PostTxExecutorABI,
} from "./contracts/abis.js";
import { connectRelayWallet, lowFeeOverrides } from "./hegotaWallet.js";

export const HEGOTA_ERC7579_FACTORY = import.meta.env.VITE_HEGOTA_ERC7579_FACTORY ?? "";
export const HEGOTA_OWNER_VALIDATOR = import.meta.env.VITE_HEGOTA_OWNER_VALIDATOR ?? "";
export const HEGOTA_POST_TX_EXECUTOR = import.meta.env.VITE_HEGOTA_POST_TX_EXECUTOR ?? "";

export function isErc7579Configured(): boolean {
  return Boolean(HEGOTA_ERC7579_FACTORY && HEGOTA_OWNER_VALIDATOR && HEGOTA_POST_TX_EXECUTOR);
}

const factoryIface = new Interface(MinimalERC7579AccountFactoryABI);
const executorIface = new Interface(PostTxExecutorABI);

export async function predictAccountAddress(provider: BrowserProvider, owner: string): Promise<string> {
  const data = factoryIface.encodeFunctionData("getAddress", [
    HEGOTA_OWNER_VALIDATOR,
    HEGOTA_POST_TX_EXECUTOR,
    owner,
  ]);
  const result = await provider.call({ to: HEGOTA_ERC7579_FACTORY, data });
  return factoryIface.decodeFunctionResult("getAddress", result)[0] as string;
}

export async function isAccountDeployed(provider: BrowserProvider, account: string): Promise<boolean> {
  const code = await provider.getCode(account);
  return code !== "0x";
}

/** Sponsored provisioning: the relay key deploys the account and installs both modules
 *  for `owner`, who never needs to hold Hegotá ETH to pay for this step. The connected
 *  wallet still signs a plain personal_sign confirmation first -- purely so the user sees
 *  and feels a wallet prompt for the action they just took; it isn't checked on-chain,
 *  the same decorative-signature pattern as demoSmartAccountAction.ts. */
export async function provisionAccount(
  provider: BrowserProvider,
  signer: JsonRpcSigner,
  owner: string,
): Promise<{ address: string; txHash: string }> {
  await signer.signMessage(`Deploy my Hegotá demo smart account\nowner: ${owner}`);
  const relay = connectRelayWallet(provider);
  const data = factoryIface.encodeFunctionData("createAccount", [
    HEGOTA_OWNER_VALIDATOR,
    HEGOTA_POST_TX_EXECUTOR,
    owner,
  ]);
  const tx = await relay.sendTransaction({ to: HEGOTA_ERC7579_FACTORY, data, ...(await lowFeeOverrides(provider)) });
  await tx.wait();
  const address = await predictAccountAddress(provider, owner);
  return { address, txHash: tx.hash };
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
