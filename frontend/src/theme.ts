import { createTheme, alpha } from "@mui/material/styles";
import type { CSSProperties } from "react";

// A dense, restrained dark palette in the vein of a private-bank dashboard (Wise/Mercury/N26),
// not a marketing site: one confident accent (primary), color reserved for state (success/
// error/warning/info), everything else near-monochrome. success/error are pinned to the exact
// hex values already baked into hegotaScenarios/* and the wallet-simulator components so that
// migrating those call sites onto theme tokens is a visual no-op, not a re-design.
declare module "@mui/material/styles" {
  interface TypeBackground {
    /** One step above `paper` -- for cards nested inside a Section/Paper (e.g. ListRow). */
    elevated: string;
  }
  interface TypographyVariants {
    mono: CSSProperties;
  }
  interface TypographyVariantsOptions {
    mono?: CSSProperties;
  }
}
declare module "@mui/material/Typography" {
  interface TypographyPropsVariantOverrides {
    mono: true;
  }
}

const theme = createTheme({
  palette: {
    mode: "dark",
    // MUI's automatic contrastText picks black here (its default contrastThreshold of 3 is
    // easily met by this violet), which reads as inconsistent against the rest of the app's
    // light-text-on-dark language -- forced to white instead.
    primary: { main: "#7166E0", light: "#9A92EA", dark: "#5449B8", contrastText: "#FFFFFF" },
    secondary: { main: "#7C8797" },
    success: { main: "#00E599" },
    error: { main: "#ff4444" },
    warning: { main: "#E0A930" },
    info: { main: "#5B9DF5" },
    background: { default: "#0B0C10", paper: "#14161C", elevated: "#1C1F27" },
    text: { primary: "#EDEEF2", secondary: "#9498A6", disabled: "#5C6070" },
    divider: "rgba(255,255,255,0.08)",
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"Inter Variable", system-ui, -apple-system, sans-serif',
    fontWeightMedium: 600,
    h4: { fontSize: "1.75rem", fontWeight: 650, lineHeight: 1.25, letterSpacing: "-0.01em" },
    h5: { fontSize: "1.375rem", fontWeight: 650, lineHeight: 1.3, letterSpacing: "-0.005em" },
    h6: { fontSize: "1.0625rem", fontWeight: 600, lineHeight: 1.35 },
    subtitle1: { fontSize: "0.9375rem", fontWeight: 600, lineHeight: 1.4 },
    subtitle2: { fontSize: "0.8125rem", fontWeight: 600, lineHeight: 1.4, letterSpacing: "0.01em" },
    body1: { fontSize: "0.9375rem", fontWeight: 400, lineHeight: 1.55 },
    body2: { fontSize: "0.8125rem", fontWeight: 400, lineHeight: 1.55 },
    caption: { fontSize: "0.75rem", fontWeight: 500, lineHeight: 1.4 },
    overline: { fontSize: "0.6875rem", fontWeight: 700, letterSpacing: "0.08em", lineHeight: 1.6 },
    button: { textTransform: "none", fontWeight: 600, fontSize: "0.875rem" },
    mono: {
      fontFamily: '"IBM Plex Mono", ui-monospace, "SFMono-Regular", monospace',
      fontFeatureSettings: '"tnum" 1',
      fontVariantNumeric: "tabular-nums",
      fontSize: "0.8125rem",
      fontWeight: 500,
      letterSpacing: "0.01em",
    },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 6 },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: "none" },
        outlined: ({ theme }) => ({
          backgroundColor: theme.palette.background.paper,
          borderColor: theme.palette.divider,
        }),
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: ({ theme }) => ({
          backgroundColor: theme.palette.background.paper,
          backgroundImage: "none",
          borderColor: theme.palette.divider,
        }),
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, borderRadius: 6 },
        sizeSmall: { fontSize: "0.75rem" },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { borderRadius: 8 },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: "none", fontWeight: 600, minHeight: 40 },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderColor: theme.palette.divider,
          padding: "8px 12px",
        }),
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: ({ theme }) => ({
          backgroundColor: theme.palette.background.elevated,
          border: `1px solid ${theme.palette.divider}`,
          fontSize: "0.75rem",
        }),
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: 6,
          "&.Mui-selected": {
            backgroundColor: alpha(theme.palette.primary.main, 0.14),
            "&:hover": { backgroundColor: alpha(theme.palette.primary.main, 0.2) },
          },
        }),
      },
    },
  },
});

export default theme;
