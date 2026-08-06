// The shape of a not-yet-signed EIP-712 request: exactly the {domain, types, message} triple
// that would be passed to signer.signTypedData(domain, types, message). Building this without
// signing lets the wallet-simulator UI show a hardware-wallet-style preview of the real request
// before (or while) the actual signature is requested.

export interface SigningRequestPreview {
  domain: Record<string, unknown>;
  primaryType: string;
  types: Record<string, Array<{ name: string; type: string }>>;
  message: Record<string, unknown>;
}

// `display` is always a flat, one-line, human-readable string, even for tuple/array arguments,
// since the drawer's DeviceScreen has a fixed height and can't scroll.
export interface DecodedArg {
  name: string;
  type: string;
  display: string;
}

export interface DecodedCall {
  functionName: string;
  args: DecodedArg[];
}

// The same shape EnforcementRow.tsx renders for every attack scenario's "Enforced State Change"
// screen, here populated from a frame's real decoded arguments instead of hand-typed text.
export interface CuratedRow {
  label: string;
  value: string;
}

// Built directly from the real FrameTx object rather than a hand-authored description, so what
// gets shown is the real structured content rather than prose that could drift from it.
export interface FrameTxSigningRequestPreview {
  chainId: number;
  sender: string;
  digestHex: string;
  frames: {
    mode: string; // "VERIFY" | "SENDER" | "DEFAULT" | "POST_TX"
    // Static, protocol-level description of what this *mode* structurally means -- true of
    // the mode itself, not the specific call, so it's safe to hardcode.
    modeGloss: string;
    target: string | null; // null => self-targeted (e.g. a self-verify VERIFY frame)
    gasLimit: string;
    value: string;
    dataHex: string;
    // Present when frame.data matched a known ABI. Absent falls back to dataHex.
    decoded: DecodedCall | null;
    // Null falls back to `decoded`'s generic argument dump (VERIFY's empty calldata, or an
    // unrecognized call).
    curatedRows: CuratedRow[] | null;
  }[];
}
