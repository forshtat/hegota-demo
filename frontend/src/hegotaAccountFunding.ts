// Funds and approves an ERC-7579 smart account (frontend/src/erc7579Account.ts) so it can
// run the live scenarios that need an IN_TOKEN balance and a MockSwap allowance (e.g. the
// MinOutput / anti-sandwich demo). Two independent sub-steps:
//   1. Fund: the relay key plain-transfers a fixed amount of HEGOTA_IN_TOKEN to the account.
//   2. Approve: the account itself calls IN_TOKEN.approve(MockSwap, max), authorized by the
//      connected wallet's EIP-712 signature (prepareViaErc7579Account + encodeExecuteAction,
//      the same pair every attack scenario's own buildFrames now composes) and submitted as a
//      plain standalone transaction to PostTxExecutor (not wrapped in a frame tx), still
//      sponsored by the relay key.

import { Interface, MaxUint256, type BrowserProvider, type JsonRpcSigner, type Wallet } from "ethers";
import { MockERC20ABI } from "./contracts/abis.js";
import { connectRelayWallet, connectFaucetWallet, lowFeeOverrides } from "./hegotaWallet.js";
import { prepareViaErc7579Account } from "./hegotaScenarios/types.js";
import { encodeExecuteAction, HEGOTA_POST_TX_EXECUTOR } from "./erc7579Account.js";
import { HEGOTA_IN_TOKEN, HEGOTA_MOCK_SWAP } from "./hegotaMinOutput.js";

const tokenIface = new Interface(MockERC20ABI);

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
// Takes an explicit, already-provider-connected signer wallet (not hardcoded to the relay key)
// so the same helper sponsors both the relay's existing fund/approve flow and the faucet's
// separate funded key below.
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

/** Sends a plain ETH top-up from the Private Swap faucet key to `toAddress` -- used by the
 *  sidebar's Faucet button. Unlike the relay key's sponsored transfers above, this key exists
 *  for exactly this one purpose (see the .env comment next to VITE_HEGOTA_FAUCET_PRIVATE_KEY). */
export async function sendHegotaFaucet(
  provider: BrowserProvider,
  chainId: number,
  toAddress: string,
  amountWei: bigint,
): Promise<string> {
  const faucet = connectFaucetWallet(provider);
  // Not the usual 21,000: Hegotá's EIP-8037 per-byte state-gas repricing makes an
  // account-creating transfer (the demo wallet's addresses are freshly generated and have
  // never touched this chain before) cost far more than historical Ethereum -- the public
  // faucet's own docs warn ~210,000 gas for exactly this case.
  return sendSigned(provider, faucet, toAddress, "0x", 250_000n, chainId, amountWei);
}

export interface FundAndApproveResult {
  fundTxHash: string;
  approveTxHash: string;
}

export async function fundAndApproveForSwap(
  provider: BrowserProvider,
  signer: JsonRpcSigner,
  chainId: number,
  accountAddress: string,
): Promise<FundAndApproveResult | null> {
  // null if the account is already funded + approved: avoids a silent double-transfer of
  // tokens plus an unnecessary wallet signature + relay-paid tx on repeat/racing callers.
  // (The button that drives this is disabled once funded, so this mainly guards races.)
  if (await isAccountFunded(provider, accountAddress)) {
    return null;
  }

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
  const approveCalldata = tokenIface.encodeFunctionData("approve", [HEGOTA_MOCK_SWAP, MaxUint256]);
  const { target, callData, signature } = await prepareViaErc7579Account(
    provider,
    signer,
    chainId,
    accountAddress,
    HEGOTA_IN_TOKEN,
    approveCalldata,
  );
  const data = encodeExecuteAction(accountAddress, target, callData, signature);
  const approveTxHash = await sendSigned(provider, relay, HEGOTA_POST_TX_EXECUTOR, data, 500_000n, chainId);
  return { fundTxHash, approveTxHash };
}
