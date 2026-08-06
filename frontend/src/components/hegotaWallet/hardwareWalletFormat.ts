import type React from "react";
import { formatEther, ZeroAddress } from "ethers";
import { shortAddr } from "../../format.js";
import type { SigningRequestPreview } from "../../signingPreview.js";

export interface HardwareWalletField {
  label: string;
  primary: React.ReactNode;
  secondary?: string;
}

const OPERATION_LABELS: Record<string, string> = { "0": "Call", "1": "DELEGATECALL" };

const DOMAIN_LABELS: Record<string, string> = {
  name: "App",
  version: "Version",
  chainId: "Chain",
  verifyingContract: "Contract",
};

const FIELD_LABELS: Record<string, string> = {
  to: "To",
  value: "Value",
  data: "Data",
  operation: "Operation",
  safeTxGas: "Safe Tx Gas",
  baseGas: "Base Gas",
  gasPrice: "Gas Price",
  gasToken: "Gas Token",
  refundReceiver: "Refund Receiver",
  nonce: "Nonce",
  account: "Account",
  target: "Target",
  callData: "Call Data",
  depositor: "Depositor",
  commitment: "Commitment",
};

const HEGOTA_CHAIN_ID = "3151908";

function formatChainId(value: unknown): string {
  const id = String(value);
  return id === HEGOTA_CHAIN_ID ? `${id} (Hegotá)` : id;
}

function formatAddress(value: unknown): string {
  const addr = String(value);
  return addr === ZeroAddress ? `${shortAddr(addr)} (none)` : shortAddr(addr);
}

function truncateHex(raw: string, maxChars: number): string {
  return raw.length > maxChars ? `${raw.slice(0, maxChars - 1)}…` : raw;
}

function formatBytesField(name: string, value: unknown, callSummary?: string): HardwareWalletField {
  const raw = String(value);
  const label = FIELD_LABELS[name] ?? name;
  if (callSummary) return { label: "Call Data Clear Signing", primary: callSummary };
  return { label, primary: truncateHex(raw, 22) };
}

export function buildHardwareWalletFields(
  preview: SigningRequestPreview,
  callSummary?: string,
): HardwareWalletField[] {
  const domainOrder = ["name", "version", "chainId", "verifyingContract"];
  const domainFields: HardwareWalletField[] = domainOrder
    .filter((key) => key in preview.domain)
    .map((key) => {
      const value = preview.domain[key];
      const primary =
        key === "chainId" ? formatChainId(value)
        : key === "verifyingContract" ? formatAddress(value)
        : String(value);
      return { label: DOMAIN_LABELS[key], primary };
    });

  const messageFields: HardwareWalletField[] = (preview.types[preview.primaryType] ?? []).map(({ name, type }) => {
    const value = preview.message[name];
    if (name === "data" || name === "callData") return formatBytesField(name, value, callSummary);
    if (name === "value") return { label: FIELD_LABELS[name], primary: `${formatEther(value as bigint)} ETH` };
    if (name === "operation") {
      return { label: FIELD_LABELS[name], primary: OPERATION_LABELS[String(value)] ?? String(value) };
    }
    if (type === "address") return { label: FIELD_LABELS[name] ?? name, primary: formatAddress(value) };
    return { label: FIELD_LABELS[name] ?? name, primary: String(value) };
  });

  return [...domainFields, ...messageFields];
}
