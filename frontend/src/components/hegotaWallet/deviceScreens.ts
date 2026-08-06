import * as React from "react";
import { Stack, Typography } from "@mui/material";
import EnforcementRow from "./EnforcementRow.js";
import { buildHardwareWalletFields, type HardwareWalletField } from "./hardwareWalletFormat.js";
import { resolveEnsName } from "../../ensLabels.js";
import type { FrameTxSigningRequestPreview, SigningRequestPreview } from "../../signingPreview.js";

// MUI's Typography prop type is polymorphic on `component`, which React.createElement's
// overloads can't resolve outside JSX (this file is a plain .ts, not .tsx). Widening the
// element type sidesteps that resolution without losing type-checking elsewhere in this file.
const Typo = Typography as React.ComponentType<Record<string, unknown>>;

export type Screen =
  | {
      kind: "detail";
      label: string;
      primary: React.ReactNode;
      secondary?: string;
      // undefined = default text.secondary header color; frame screens set "warning" for
      // VERIFY/SENDER/DEFAULT, "info" for POST_TX.
      accent?: "warning" | "info";
      // The "Safety check" badge next to the label -- only a POST_TX frame screen sets this.
      chip?: string;
    }
  | { kind: "group"; fields: HardwareWalletField[] };

// Technical detail fields (domain info, gas params, nonce, ...) are packed together this many
// at a time rather than one per screen, since a real device wouldn't make you click through a
// dozen individual gas-param screens one at a time.
const TECHNICAL_FIELDS_PER_SCREEN = 5;

export function buildHardwareWalletScreens(
  preview: SigningRequestPreview,
  callSummary?: string,
  enforcementText?: React.ReactNode,
): Screen[] {
  const baseFields = buildHardwareWalletFields(preview, callSummary);

  const callDataIndex = baseFields.findIndex(
    (f) => f.label === "Call Data" || f.label === "Data" || f.label === "Call Data Clear Signing",
  );
  const callDataField = callDataIndex >= 0 ? baseFields.splice(callDataIndex, 1)[0] : null;

  const screens: Screen[] = [];
  if (callDataField) screens.push({ kind: "detail", ...callDataField });
  if (enforcementText) screens.push({ kind: "detail", label: "Enforced State Change", primary: enforcementText });
  for (let i = 0; i < baseFields.length; i += TECHNICAL_FIELDS_PER_SCREEN) {
    screens.push({ kind: "group", fields: baseFields.slice(i, i + TECHNICAL_FIELDS_PER_SCREEN) });
  }
  return screens;
}

// Local, not the shared shortAddr (format.ts): uses "..." rather than shortAddr's "…".
function short(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function label(addr: string): string {
  return resolveEnsName(addr) ?? short(addr);
}

export function buildFrameTxScreens(preview: FrameTxSigningRequestPreview): Screen[] {
  const frameScreens: Screen[] = preview.frames.map((frame, i) => {
    const isPostTx = frame.mode === "POST_TX";

    const body = frame.curatedRows
      ? React.createElement(
          Stack,
          { spacing: 0.5, sx: { mt: 0.25 } },
          frame.curatedRows.map((row) =>
            React.createElement(EnforcementRow, { key: row.label, label: `${row.label}:`, value: row.value }),
          ),
        )
      : frame.decoded
        ? React.createElement(
            Stack,
            { spacing: 0.15 },
            React.createElement(
              Typo,
              { variant: "mono", component: "div", sx: { fontSize: "0.75rem", fontWeight: 700 } },
              `${frame.decoded.functionName}(...)`,
            ),
            frame.decoded.args.map((arg) =>
              React.createElement(
                Typo,
                {
                  key: arg.name,
                  variant: "mono",
                  component: "div",
                  sx: { fontSize: "0.7rem", color: "text.secondary", wordBreak: "break-word" },
                },
                `${arg.name}: ${arg.display}`,
              ),
            ),
          )
        : React.createElement(
            Typo,
            {
              variant: "mono",
              component: "div",
              sx: { fontSize: "0.7rem", color: "text.secondary", wordBreak: "break-word" },
            },
            frame.dataHex === "0x" ? "(no calldata)" : frame.dataHex,
          );

    const primary = React.createElement(
      Stack,
      { spacing: 0.5 },
      frame.modeGloss
        ? React.createElement(
            Typo,
            { variant: "caption", color: "text.secondary", sx: { fontStyle: "italic", display: "block" } },
            frame.modeGloss,
          )
        : null,
      React.createElement(
        Typo,
        { variant: "mono", component: "div", sx: { fontSize: "0.75rem" } },
        frame.target ? `→ ${label(frame.target)}` : "→ (self)",
      ),
      body,
      // Skipped when curatedRows is set: a curated row (e.g. "Shielding: 0.01 ETH") is already
      // built from this same frame.value, so this would just duplicate it as raw wei.
      frame.value !== "0" && !frame.curatedRows
        ? React.createElement(
            Typo,
            { variant: "caption", color: "text.secondary", sx: { opacity: 0.7 } },
            `value ${frame.value}`,
          )
        : null,
    );

    return {
      kind: "detail",
      label: `Frame ${i + 1}/${preview.frames.length} — ${frame.mode}`,
      accent: isPostTx ? "info" : "warning",
      chip: isPostTx ? "Safety check" : undefined,
      primary,
    };
  });

  const digestScreen: Screen = {
    kind: "detail",
    label: "Signed digest",
    accent: "warning",
    // Both lines are composed into `primary` rather than using the generic `secondary` slot,
    // since each needs its own distinct styling that DeviceReviewScreen's fixed secondary-text
    // style (wordBreak break-all, no top margin) can't produce for both at once.
    primary: React.createElement(
      Stack,
      { spacing: 0.65 },
      React.createElement(
        Typo,
        { variant: "mono", component: "div", sx: { fontSize: "0.7rem", wordBreak: "break-all", color: "text.secondary" } },
        preview.digestHex,
      ),
      React.createElement(
        Typo,
        { variant: "caption", color: "text.secondary", sx: { opacity: 0.7, display: "block", mt: 0.5 } },
        `chain ${preview.chainId} · sender ${label(preview.sender)}`,
      ),
    ),
  };

  return [...frameScreens, digestScreen];
}
