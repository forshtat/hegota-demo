// The EIP-712 type name ("PostTxAction") and domain name below are NOT free to rename:
// contracts/erc7579/PostTxExecutor.sol hardcodes both as bytecode constants (TYPEHASH,
// DOMAIN_NAME) to compute its own domain separator on-chain, and that contract is already
// deployed to Hegotá -- changing the wire-level strings here without redeploying it (and
// re-provisioning every account wired to the old executor address) breaks every signature
// with PostTxExecutor's InvalidSignature() error.

import type { JsonRpcSigner } from "ethers";
import type { SigningRequestPreview } from "../signingPreview.js";

export interface DemoSmartAccountAction {
  account: string;
  target: string;
  callData: string;
  nonce: bigint;
}

// Field list must match PostTxExecutor.sol's TYPEHASH exactly -- see the note above.
export const DEMO_SMART_ACCOUNT_ACTION_TYPES = {
  PostTxAction: [
    { name: "account", type: "address" },
    { name: "target", type: "address" },
    { name: "callData", type: "bytes" },
    { name: "nonce", type: "uint256" },
  ],
};

// Must match PostTxExecutor.sol's DOMAIN_NAME exactly -- see the note above.
function buildDomain(chainId: number) {
  return { name: "Hegotá POST_TX Demo", version: "1", chainId };
}

export async function signDemoSmartAccountAction(
  signer: JsonRpcSigner,
  chainId: number,
  action: DemoSmartAccountAction,
): Promise<string> {
  return signer.signTypedData(buildDomain(chainId), DEMO_SMART_ACCOUNT_ACTION_TYPES, action);
}

export function previewDemoSmartAccountAction(
  chainId: number,
  action: DemoSmartAccountAction,
): SigningRequestPreview {
  return {
    domain: buildDomain(chainId),
    primaryType: "PostTxAction",
    types: DEMO_SMART_ACCOUNT_ACTION_TYPES,
    message: action as unknown as Record<string, unknown>,
  };
}
