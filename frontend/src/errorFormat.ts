// Every ethers v6 error carries a `.shortMessage` alongside `.message` -- `.message` is the
// *entire* serialized error (action/reason/info/code/version, often including the full request
// payload as JSON) intended for logs, while `.shortMessage` is the human-readable summary meant
// for exactly this purpose. Several call sites in this app were displaying `.message` directly,
// dumping raw JSON into the UI (e.g. a rejected signature showing its whole eth_signTypedData_v4
// payload). This is the one place that decision gets made.
//
// `.shortMessage` isn't always the most useful summary, though: for a raw JSON-RPC error ethers
// couldn't classify (e.g. `eth_sendRawTransaction` rejecting a transaction for a reason ethers
// has no specific ErrorCode for), ethers' own generic wrapper message is "could not coalesce
// error" -- true of the wrapper, tells the user nothing about what actually went wrong -- while
// the node's own real reason (e.g. "Invalid params: Account does not have enough balance to
// cover the tx cost") sits one level deeper -- but ethers is inconsistent about exactly where:
// checked directly against ethers 6.16.0's own source (providers/provider-jsonrpc.js) rather
// than assumed from EthersError's type declarations. The generic "could not coalesce error"
// bucket (getRpcError's final fallback -- what an unrecognized eth_sendRawTransaction rejection
// hits) does `makeError(msg, code, { error, payload })`, which spreads those keys directly onto
// the error object (`e.error.message`, confirmed live against a real BrowserProvider failure --
// `e.info` doesn't exist on it at all). Other call sites in the same file (e.g.
// ACTION_REJECTED, a rejected signature) instead do `{ info: { payload, error } }`, one level
// deeper. Check both locations; only a real ethers ErrorCode wrapper with nothing more specific
// underneath falls all the way back to `.shortMessage`, same as before.
const MAX_LENGTH = 300;

export function formatWalletError(e: unknown): string {
  const err = e as {
    shortMessage?: unknown;
    error?: { message?: unknown };
    info?: { error?: { message?: unknown } };
  } | null;
  const nestedRpcMessage = err?.error?.message ?? err?.info?.error?.message;
  const shortMessage = err?.shortMessage;
  const message =
    typeof nestedRpcMessage === "string"
      ? nestedRpcMessage
      : typeof shortMessage === "string"
        ? shortMessage
        : e instanceof Error
          ? e.message
          : String(e);
  return message.length > MAX_LENGTH ? `${message.slice(0, MAX_LENGTH)}…` : message;
}
