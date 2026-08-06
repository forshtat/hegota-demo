import { Contract, type JsonRpcSigner, type Provider, ZeroAddress } from "ethers";
import { SudoModuleABI } from "./abis.js";
import type { SigningRequestPreview } from "../signingPreview.js";

export const SAFE_ABI = [
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)",
  "function nonce() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function setGuard(address guard)",
  "function swapOwner(address prevOwner, address oldOwner, address newOwner)",
  "function changeThreshold(uint256 _threshold)",
  "function getThreshold() view returns (uint256)",
  "function setup(address[] owners, uint256 threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function enableModule(address module)",
];

// Shared by previewSafeExecTransaction and the two signing functions below so a preview
// can never drift from what's actually signed.
const SAFE_TX_TYPES = {
  SafeTx: [
    { name: "to",             type: "address" },
    { name: "value",          type: "uint256" },
    { name: "data",           type: "bytes"   },
    { name: "operation",      type: "uint8"   },
    { name: "safeTxGas",      type: "uint256" },
    { name: "baseGas",        type: "uint256" },
    { name: "gasPrice",       type: "uint256" },
    { name: "gasToken",       type: "address" },
    { name: "refundReceiver", type: "address" },
    { name: "nonce",          type: "uint256" },
  ],
};

function buildSafeTxDomain(chainId: bigint, safeAddress: string) {
  return { chainId, verifyingContract: safeAddress };
}

export async function previewSafeExecTransaction(
  safeAddress: string,
  provider: Provider,
  to: string,
  value: bigint,
  data: string,
  operation: number,
): Promise<SigningRequestPreview> {
  const safe = new Contract(safeAddress, SAFE_ABI, provider);
  const chainId = (await provider.getNetwork()).chainId;
  const nonce = await safe.nonce() as bigint;
  return {
    domain: buildSafeTxDomain(chainId, safeAddress),
    primaryType: "SafeTx",
    types: SAFE_TX_TYPES,
    message: {
      to, value, data, operation, safeTxGas: 0n, baseGas: 0n,
      gasPrice: 0n, gasToken: ZeroAddress, refundReceiver: ZeroAddress, nonce,
    },
  };
}

export async function safeExec(
  safeAddress: string,
  signer: JsonRpcSigner,
  to: string,
  value: bigint,
  data: string,
  overrides?: { gasLimit?: bigint },
) {
  const preview = await previewSafeExecTransaction(safeAddress, signer.provider, to, value, data, 0);
  const sig = await signer.signTypedData(preview.domain, preview.types, preview.message);

  const safe = new Contract(safeAddress, SAFE_ABI, signer);
  return (await safe.execTransaction(
    to, value, data, 0, 0, 0, 0, ZeroAddress, ZeroAddress, sig,
    overrides ?? {},
  )).wait();
}

// Builds and signs a real SafeTx, returning the Safe.execTransaction(...) calldata WITHOUT
// submitting it -- the caller submits it as a frame tx's DEFAULT frame.
// `operation`: CALL (0) for a normal action, DELEGATECALL (1) for the control-plane-takeover
// attack (contracts/hegota/MaliciousSafeDelegate.sol), where the target contract's code runs
// against the Safe's own storage instead of its own.
export async function buildSafeExecTransaction(
  safeAddress: string,
  signer: JsonRpcSigner,
  to: string,
  value: bigint,
  data: string,
  operation: number,
  overrides?: { gasLimit?: number },
): Promise<{ target: string; data: string; gasLimit: number }> {
  const preview = await previewSafeExecTransaction(safeAddress, signer.provider, to, value, data, operation);
  const sig = await signer.signTypedData(preview.domain, preview.types, preview.message);

  const safe = new Contract(safeAddress, SAFE_ABI, signer);
  const execCalldata = safe.interface.encodeFunctionData("execTransaction", [
    to, value, data, operation, 0, 0, 0, ZeroAddress, ZeroAddress, sig,
  ]);

  return { target: safeAddress, data: execCalldata, gasLimit: overrides?.gasLimit ?? 400_000 };
}

// Returns false (rather than throwing) if the contract doesn't exist yet.
export async function isSafeOwned(safeAddress: string, signer: JsonRpcSigner): Promise<boolean> {
  try {
    const safe = new Contract(safeAddress, SAFE_ABI, signer);
    const owners: string[] = await safe.getOwners();
    const my = (await signer.getAddress()).toLowerCase();
    return owners.some((o: string) => o.toLowerCase() === my);
  } catch {
    return false;
  }
}

// Idempotent: no-op if the wallet already owns the Safe.
export async function claimSafe(
  safeAddress: string,
  sudoModuleAddress: string,
  signer: JsonRpcSigner,
) {
  const code = await signer.provider.getCode(safeAddress);
  if (code === "0x") throw new Error(
    "Safe contract not found at the deployed address — run `npm run deploy` first and reload the page"
  );

  const safe = new Contract(safeAddress, SAFE_ABI, signer);
  const owners: string[] = await safe.getOwners();
  const myAddress = await signer.getAddress();
  if (owners.map((o: string) => o.toLowerCase()).includes(myAddress.toLowerCase())) return;

  const sudoModule = new Contract(sudoModuleAddress, SudoModuleABI, signer);
  await (await sudoModule.claimAndReset(safeAddress)).wait();
}
