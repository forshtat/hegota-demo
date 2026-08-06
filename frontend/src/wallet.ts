import { createAppKit } from "@reown/appkit";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import type { AppKitNetwork } from "@reown/appkit/networks";
import theme from "./theme.js";

const chainId = parseInt(import.meta.env.VITE_CHAIN_ID ?? "1337");
const hegotaChainId = parseInt(import.meta.env.VITE_HEGOTA_CHAIN_ID ?? "3151908");

const ethrexNetwork: AppKitNetwork = {
  id: chainId,
  name: "EthRex (local)",
  caipNetworkId: `eip155:${chainId}`,
  chainNamespace: "eip155",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  // AppKit requires rpcUrls but we connect exclusively through MetaMask.
  // The URL below is only used by AppKit's internal balance-polling provider,
  // which will fail with a CORS error from public origins — that is expected
  // and harmless; it does not affect wallet connectivity or transactions.
  rpcUrls: { default: { http: ["http://localhost:8545"] } },
};

// Registered so users can conveniently switch MetaMask to Hegotá (e.g. to see their
// faucet-funded balance). The POST_TX Assertion demo itself does not use this network
// object or MetaMask at all — it signs/submits frame transactions with its own hot
// wallet, since MetaMask cannot represent EIP-8141 type-0x06 transactions.
const hegotaNetwork: AppKitNetwork = {
  id: hegotaChainId,
  name: "Hegotá (devnet)",
  caipNetworkId: `eip155:${hegotaChainId}`,
  chainNamespace: "eip155",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [import.meta.env.VITE_HEGOTA_RPC_URL ?? "https://rpc1.hegota.ethrex.xyz"] } },
  blockExplorers: { default: { name: "Dora", url: "https://dora.hegota.ethrex.xyz" } },
};

export { ethrexNetwork, hegotaNetwork };

const adapter = new EthersAdapter();

// Captured so callers that need to force a balance refresh (e.g. the sidebar's faucet button)
// can call .updateNativeBalance() directly on this exact instance.
// @reown/appkit/react's useAppKitBalance hook looks tempting for that, but it reads its
// own separate module-level `modal` singleton that only ever gets set by *that* package's
// own createAppKit -- since this app calls the base @reown/appkit package's createAppKit
// (needed for the plain AppKit/EthersAdapter setup below), that singleton is never
// initialized and the hook throws "AppKit not initialized when fetchBalance was called."
export const appKit = createAppKit({
  adapters: [adapter],
  // EthRex (local) only matters for local development (letting a developer point MetaMask
  // at their own local node) -- registering it in a *production* build means AppKit tries
  // to poll its balance from http://localhost:8545 on every visitor's machine. Chrome's
  // Local Network Access feature (Chrome 141+) intercepts that as a public-page-to-localhost
  // request and prompts every visitor to "access other apps and services on this device" for
  // a network that, on the public demo, never actually exists on their machine. Only
  // registered in dev.
  networks: import.meta.env.DEV ? [ethrexNetwork, hegotaNetwork] : [hegotaNetwork],
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "",
  // Required for WalletConnect's own protocol handshake and for the embedded-wallet
  // (email/social) flow below to render proper branding instead of a blank/generic screen.
  // `url` is derived from the current origin so this stays correct across local dev and
  // any deployment without hardcoding a domain.
  metadata: {
    name: "EIP-7906 Threat Demo",
    description: "See how EIP-7906 lets a transaction catch a compromised wallet UI after it signs -- six real attack patterns, running live against your own wallet.",
    url: window.location.origin,
    icons: [`${window.location.origin}/icon.svg`],
  },
  features: {
    analytics: false,
    // Explicit (matches the library default, but kept deliberate rather than left to
    // whatever a future @reown/appkit version's default happens to be): lets someone
    // without a wallet extension try the demo via a non-custodial email-based embedded
    // wallet instead of being blocked entirely.
    email: true,
  },
  // Without this, <appkit-button/> renders with Reown's own default blue -- jarring
  // against this app's actual palette. Pulling the values from theme.ts keeps the
  // connect button and modal in sync with the rest of the design system.
  themeMode: "dark",
  themeVariables: {
    "--w3m-accent": theme.palette.primary.main,
    "--w3m-border-radius-master": "2px",
  },
});

// The themeVariables config above doesn't reliably reach the connect button's actual
// background token in this AppKit version (its derived --apkt-tokens-core-* accent
// variables render the library's own default blue regardless) -- so those specific
// tokens are forced directly, with !important so they win regardless of injection
// order against AppKit's own dynamically-appended stylesheet.
//
// Separately, and independently of that: the button's own label text isn't styled via
// any of the --apkt-tokens-core-* accent tokens at all -- wui-connect-button's "primary"
// variant renders its label with color="invert", which reads --apkt-tokens-theme-textInvert
// (a *theme*-level token, not a core/accent one). themeMode:"dark" above also doesn't
// reliably take effect for that token in production builds -- it was observed resolving
// to the *light*-theme value (#202020, near-black) despite requesting dark mode -- so the
// button rendered near-black text on our violet background. Forced directly here too.
const accentOverrideStyle = document.createElement("style");
accentOverrideStyle.textContent = `:root {
  --apkt-tokens-core-backgroundAccentPrimary: ${theme.palette.primary.main} !important;
  --apkt-tokens-core-borderAccentPrimary: ${theme.palette.primary.main} !important;
  --apkt-tokens-core-textAccentPrimary: ${theme.palette.primary.main} !important;
  --apkt-tokens-core-iconAccentPrimary: ${theme.palette.primary.main} !important;
  --apkt-tokens-theme-textInvert: ${theme.palette.primary.contrastText} !important;
}`;
document.head.appendChild(accentOverrideStyle);
