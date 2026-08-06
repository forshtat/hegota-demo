// The shielded note's secret (spendKey, rho) plus its public deposit metadata, encoded as one
// copy-pasteable string. This is the ONLY channel the note ever crosses from the depositor
// side of the demo to the withdrawer side: PrivateSwap.tsx shows this string exactly once,
// right after a successful shield, and requires it to be pasted back in on the Private side
// before a withdrawal can be built. There is deliberately no other channel -- no localStorage,
// no shared React state -- carrying the secret between the two. If you don't copy it, it's
// gone: refreshing the page, or never copying it in the first place, loses the note, same as
// losing a hardware wallet's seed phrase (and same as the pool's own Python wallet, which is
// just as disposable -- see wallet/README.md).

const TICKET_PREFIX = "hegota-note-v1:";

export interface SecretNote {
  spendKey: string; // decimal string (bigint)
  rho: string;
  value: string; // wei, decimal string
  shieldTxHash: string;
  shieldBlockNumber: number;
  cm: string;
  depositorAddress: string; // the real tx.sender when self-sovereign; otherwise who attested
  // EIP-712 DepositAttestation signature (see depositAttestation.ts) -- only present for the
  // real-wallet fallback path. A self-sovereign deposit (embedded wallet, real EIP-8141 tx) has
  // no separate attestation: depositorAddress IS the transaction's own sender, already
  // verifiable on-chain, so there's nothing left to sign or verify off-chain.
  depositorSignature?: string;
}

export function encodeSecretNote(note: SecretNote): string {
  return TICKET_PREFIX + btoa(JSON.stringify(note));
}

export function decodeSecretNote(ticket: string): SecretNote {
  const trimmed = ticket.trim();
  if (!trimmed.startsWith(TICKET_PREFIX)) {
    throw new Error(`Not a recognized note -- it should start with "${TICKET_PREFIX}".`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(atob(trimmed.slice(TICKET_PREFIX.length)));
  } catch {
    throw new Error("Couldn't decode this note -- make sure you copied the whole string.");
  }
  const n = parsed as Partial<SecretNote> | null;
  if (
    !n || typeof n !== "object" ||
    typeof n.spendKey !== "string" ||
    typeof n.rho !== "string" ||
    typeof n.value !== "string" ||
    typeof n.shieldTxHash !== "string" ||
    typeof n.shieldBlockNumber !== "number" ||
    typeof n.cm !== "string" ||
    typeof n.depositorAddress !== "string"
  ) {
    throw new Error("This note is missing required fields -- make sure you copied the whole string.");
  }
  return n as SecretNote;
}
