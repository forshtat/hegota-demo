// Funds and approves an ERC-7579 smart account (frontend/src/erc7579Account.ts) so it can
// run the live scenarios that need an IN_TOKEN balance and a MockSwap allowance (e.g. the
// MinOutput / anti-sandwich demo). Two independent sub-steps:
//   1. Fund: the relay key plain-transfers a fixed amount of HEGOTA_IN_TOKEN to the account.
//   2. Approve: the account itself calls IN_TOKEN.approve(MockSwap, max), authorized by the
//      connected wallet's EIP-712 signature (prepareViaErc7579Account + encodeExecuteAction,
//      the same pair every attack scenario's own buildFrames now composes) and submitted as a
//      plain standalone transaction to PostTxExecutor (not wrapped in a frame tx), still
//      sponsored by the relay key.

import { Interface, MaxUint256, getBytes, type BrowserProvider, type JsonRpcSigner, type Wallet } from "ethers";
import { MockERC20ABI } from "./contracts/abis.js";
import { connectRelayWallet, lowFeeOverrides, type FrameTxPlan } from "./hegotaWallet.js";
import { Frame, FrameMode } from "./frametx.js";
import { fetchSelfVerifyNonce, registerKnownInterface } from "./frameSigning.js";
import { prepareViaErc7579Account } from "./hegotaScenarios/types.js";
import { encodeExecuteAction, HEGOTA_POST_TX_EXECUTOR, SELF_VERIFY_SENTINEL } from "./erc7579Account.js";
import { HEGOTA_IN_TOKEN, HEGOTA_MOCK_SWAP } from "./hegotaMinOutput.js";

const tokenIface = new Interface(MockERC20ABI);
// So the wallet-simulator drawer's device screens (ProvisioningPanel.tsx) can decode the
// mint() call by name+args instead of showing raw hex.
registerKnownInterface(tokenIface);

const FUND_AMOUNT = 1_000n * 10n ** 18n;

export async function isAccountFunded(provider: BrowserProvider, accountAddress: string): Promise<boolean> {
  const balanceData = tokenIface.encodeFunctionData("balanceOf", [accountAddress]);
  const balanceResult = await provider.call({ to: HEGOTA_IN_TOKEN, data: balanceData });
  const balance = tokenIface.decodeFunctionResult("balanceOf", balanceResult)[0] as bigint;

  const allowanceData = tokenIface.encodeFunctionData("allowance", [accountAddress, HEGOTA_MOCK_SWAP]);
  const allowanceResult = await provider.call({ to: HEGOTA_IN_TOKEN, data: allowanceData });
  const allowance = tokenIface.decodeFunctionResult("allowance", allowanceResult)[0] as bigint;

  return balance > 0n && allowance > 0n;
}

// Built and sent via raw provider.send() calls throughout (never ethers' high-level
// sendTransaction/.wait()): once a recent block contains a frame transaction, ethers'
// internal block-confirmation polling (used by those convenience methods) can crash trying
// to parse it as a legacy/EIP-1559-shaped transaction (see hegotaMinOutput.ts's sandwichRate).
async function sendSigned(
  provider: BrowserProvider,
  signerWallet: Wallet,
  to: string,
  data: string,
  gasLimit: bigint,
  chainId: number,
  value: bigint = 0n,
): Promise<string> {
  // "latest" (confirmed), not "pending" -- see hegotaMinOutput.ts's sandwichRate for why.
  const nonce = await provider.send("eth_getTransactionCount", [signerWallet.address, "latest"]);

  const signedTx = await signerWallet.signTransaction({
    type: 2,
    chainId: BigInt(chainId),
    nonce: parseInt(nonce, 16),
    to,
    data,
    gasLimit,
    value,
    ...(await lowFeeOverrides(provider)),
  });
  const txHash = await provider.send("eth_sendRawTransaction", [signedTx]);
  for (let i = 0; i < 20; i++) {
    const receipt = await provider.send("eth_getTransactionReceipt", [txHash]);
    if (receipt) {
      if (receipt.status !== "0x1") {
        throw new Error(`Transaction ${txHash} reverted (status ${receipt.status})`);
      }
      return txHash;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Transaction ${txHash} did not confirm within the poll window`);
}

export interface FundAndApproveResult {
  fundTxHash: string;
  approveTxHash: string;
}

/** Sponsored fund+approve (real wallets): a plain relay-signed transfer of a fixed amount of
 *  IN_TOKEN to the account, then a plain (non-frame) approve transaction to PostTxExecutor,
 *  both paid for by the relay key. `null` if already funded (avoids a silent double-transfer
 *  on repeat/racing callers -- the button that drives this is disabled once funded, so this
 *  mainly guards races). */
export async function fundAndApproveForSwap(
  provider: BrowserProvider,
  signer: JsonRpcSigner,
  chainId: number,
  accountAddress: string,
): Promise<FundAndApproveResult | null> {
  if (await isAccountFunded(provider, accountAddress)) {
    return null;
  }

  const approveCalldata = tokenIface.encodeFunctionData("approve", [HEGOTA_MOCK_SWAP, MaxUint256]);
  const { target, callData, signature } = await prepareViaErc7579Account(
    provider,
    signer,
    chainId,
    accountAddress,
    HEGOTA_IN_TOKEN,
    approveCalldata,
  );
  const executeData = encodeExecuteAction(accountAddress, target, callData, signature);

  // 1. Fund: a plain relay-signed transfer of a fixed amount of IN_TOKEN to the account.
  // The connected wallet signs a decorative personal_sign confirmation first -- not checked
  // on-chain, purely so the user sees a wallet prompt and gets a tx to look at, instead of
  // the balance silently changing underneath them.
  await signer.signMessage(`Fund my Hegotá demo account with ${FUND_AMOUNT / 10n ** 18n} IN\naccount: ${accountAddress}`);
  const relay = connectRelayWallet(provider);
  const transferData = tokenIface.encodeFunctionData("transfer", [accountAddress, FUND_AMOUNT]);
  const fundTxHash = await sendSigned(provider, relay, HEGOTA_IN_TOKEN, transferData, 200_000n, chainId);

  // 2. Approve: authorized by the connected wallet's real EIP-712 signature, then submitted as
  // a plain (non-frame) transaction to PostTxExecutor, still paid for by the relay key.
  const approveTxHash = await sendSigned(provider, relay, HEGOTA_POST_TX_EXECUTOR, executeData, 500_000n, chainId);
  return { fundTxHash, approveTxHash };
}

/** Self-funded fund+approve (Demo Wallet): prepares the FrameTxPlan for a bare `self_verify`
 *  frame transaction (no deploy frame -- the account already exists) in which the account
 *  mints its own IN_TOKEN, then approves MockSwap, both paid from its own balance (left over
 *  from provisionAccount's faucet claim -- Hegotá's ~7 wei base fee comfortably covers both
 *  steps' gas from a single 1 ETH claim). Not atomic-batched: isAccountFunded's own
 *  balance>0 && allowance>0 check already tolerates a partial outcome (mint succeeds, approve
 *  doesn't) by simply reporting "not funded yet", leaving this retriable. Submission itself is
 *  left to the caller (ProvisioningPanel.tsx). Throws if the account is already funded --
 *  the panel that drives this is only ever armed from a button already gated on !isFunded, so
 *  this only guards a genuine race. */
export async function prepareFundAndApproveForSwap(
  provider: BrowserProvider,
  signer: JsonRpcSigner,
  chainId: number,
  accountAddress: string,
  reportProgress: (label: string) => Promise<void>,
): Promise<{ plan: FrameTxPlan; signerAddress: string }> {
  if (await isAccountFunded(provider, accountAddress)) {
    throw new Error("Account is already funded and approved");
  }

  await reportProgress("Authorizing the MockSwap approval");
  const approveCalldata = tokenIface.encodeFunctionData("approve", [HEGOTA_MOCK_SWAP, MaxUint256]);
  const { target, callData, signature } = await prepareViaErc7579Account(
    provider,
    signer,
    chainId,
    accountAddress,
    HEGOTA_IN_TOKEN,
    approveCalldata,
  );
  const executeData = encodeExecuteAction(accountAddress, target, callData, signature);

  await reportProgress("Building the fund + approve transaction");
  const mintCalldata = tokenIface.encodeFunctionData("mint", [accountAddress, FUND_AMOUNT]);
  const nonceSeq = await fetchSelfVerifyNonce(provider, accountAddress);
  const plan: FrameTxPlan = {
    sender: accountAddress,
    nonceKeys: [0],
    nonceSeq,
    frames: [
      new Frame(FrameMode.VERIFY, 0x03, accountAddress, 200_000, 0, SELF_VERIFY_SENTINEL),
      new Frame(FrameMode.DEFAULT, 0, HEGOTA_IN_TOKEN, 200_000, 0, getBytes(mintCalldata)),
      new Frame(FrameMode.DEFAULT, 0, HEGOTA_POST_TX_EXECUTOR, 500_000, 0, getBytes(executeData)),
    ],
  };
  return { plan, signerAddress: signer.address };
}
