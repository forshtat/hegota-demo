// Stubs window.ethereum with a small set of ethers Wallets so the whole demo (connect, network
// switch, account setup, attack scenarios, POST_TX submission) can be driven end-to-end without a
// real wallet extension -- lets a visitor with no MetaMask and no funds try the whole thing. Most
// of these "wallets" never need to hold any ETH: every relay-sponsored transaction (provision/
// fund/Safe-provision) is submitted by the app's own relay key, never by one of these signers --
// they only ever produce personal_sign / eth_signTypedData_v4 signatures and switch
// networks/accounts. The one exception is Private Swap (see signAutoWalletDigest below), which
// signs and submits real EIP-8141 transactions directly from one of these accounts' own keys --
// that page's faucet button is what funds it. Always installed; generates and persists
// NUM_ACCOUNTS throwaway keys in localStorage on first use for that browser (never reused across
// browsers -- safe to keep client-side even in production).
//
// Holds more than one account (not just one) so the Private Swap page's account-switch gate can
// be exercised for real: selectAutoWalletAccount() fires a genuine EIP-1193 accountsChanged
// event, exactly like a real wallet's own account switch, instead of requiring a manual
// localStorage clear + reload.
import { JsonRpcProvider, Wallet, getBytes, isHexString } from "ethers";

const NUM_ACCOUNTS = 3;
const ACCOUNTS_KEY = "__hegota_autowallet_accounts__";
const LEGACY_PK_KEY = "__hegota_autowallet_pk__";

interface StoredAccounts {
  pks: string[];
  currentIndex: number;
}

function loadOrCreateAccounts(): StoredAccounts {
  const raw = localStorage.getItem(ACCOUNTS_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as StoredAccounts;
      if (Array.isArray(parsed.pks) && parsed.pks.length === NUM_ACCOUNTS) return parsed;
    } catch {
      // fall through and regenerate below
    }
  }
  // Migrate the old single-key value in as slot 0 so an existing session keeps its address.
  const legacy = localStorage.getItem(LEGACY_PK_KEY);
  const pks: string[] = legacy ? [legacy] : [];
  while (pks.length < NUM_ACCOUNTS) pks.push(Wallet.createRandom().privateKey);
  const accounts: StoredAccounts = { pks, currentIndex: 0 };
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  return accounts;
}

function hexChainId(id: number): string {
  return "0x" + id.toString(16);
}

// A small shield-and-checkmark mark (matches frontend/public/icon.svg) base64-encoded into a
// proper data: URI -- EIP-6963's `icon` field must be self-contained, not a regular URL.
const AUTO_WALLET_ICON = `data:image/svg+xml;base64,${btoa(
  '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">' +
  '<rect width="64" height="64" rx="14" fill="#0B0C10"/>' +
  '<path d="M32 8 L52 16 V30 C52 44 44 53 32 58 C20 53 12 44 12 30 V16 Z" fill="#7166E0"/>' +
  '<path d="M23 32 L29 38 L41 24" stroke="#FFFFFF" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' +
  '</svg>',
)}`;

type Listener = (...args: unknown[]) => void;

let wallets: Wallet[] = [];
let currentIndex = 0;
let cachedAccounts: StoredAccounts | null = null;
let providerListeners: Record<string, Set<Listener>> | null = null;
let ethereumRef: { selectedAddress: string } | null = null;
const snapshotSubscribers = new Set<() => void>();

function currentWallet(): Wallet {
  return wallets[currentIndex];
}

export interface AutoWalletSnapshot {
  accounts: { address: string }[];
  currentIndex: number;
}

export function getAutoWalletSnapshot(): AutoWalletSnapshot {
  return { accounts: wallets.map((w) => ({ address: w.address })), currentIndex };
}

/** Subscribes to account-selection changes; returns an unsubscribe function. */
export function subscribeAutoWallet(cb: () => void): () => void {
  snapshotSubscribers.add(cb);
  return () => snapshotSubscribers.delete(cb);
}

/** Signs an arbitrary 32-byte digest with the currently-selected account's own key -- real
 *  wallets deliberately don't expose raw digest signing (it can be used to forge signatures for
 *  anything), but we fully control this stub's keys, so it's safe here. This is what lets
 *  Private Swap (shieldedPool/privateSwapTx.ts) submit genuine, self-signed EIP-8141
 *  transactions instead of routing through the relay key or an EIP-712 side-channel. Called
 *  directly by page/helper code, not through window.ethereum.request -- there's no standard
 *  EIP-1193 method for this. */
export function signAutoWalletDigest(digest: Uint8Array): { yParity: number; r: string; s: string } {
  const sig = currentWallet().signingKey.sign(digest);
  return { yParity: sig.yParity, r: sig.r, s: sig.s };
}

/** Switches the stub's active account and fires a real accountsChanged event, exactly like a
 *  real wallet's own account switch -- this is what the rest of the app (AppKit -> WalletContext)
 *  reacts to. */
export function selectAutoWalletAccount(index: number): void {
  if (index === currentIndex || index < 0 || index >= wallets.length) return;
  currentIndex = index;
  if (cachedAccounts) {
    cachedAccounts.currentIndex = index;
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(cachedAccounts));
  }
  const address = wallets[index].address;
  if (ethereumRef) ethereumRef.selectedAddress = address;
  snapshotSubscribers.forEach((cb) => cb());
  providerListeners?.["accountsChanged"]?.forEach((cb) => cb([address]));
}

export function maybeInstallAutoWallet(): void {
  const stored = loadOrCreateAccounts();
  cachedAccounts = stored;
  wallets = stored.pks.map((pk) => new Wallet(pk));
  currentIndex = Math.min(stored.currentIndex, wallets.length - 1);

  const chainRpc: Record<number, string> = {
    [parseInt(import.meta.env.VITE_CHAIN_ID ?? "1337")]: "http://localhost:8545",
    [parseInt(import.meta.env.VITE_HEGOTA_CHAIN_ID ?? "3151908")]:
      import.meta.env.VITE_HEGOTA_RPC_URL ?? "https://rpc1.hegota.ethrex.xyz",
  };
  // Every live scenario in this demo runs on Hegotá, not local EthRex (that network only
  // matters for a developer pointing MetaMask at their own local node -- see wallet.ts) --
  // so the stub should already be on Hegotá the moment it's connected, rather than starting
  // on chain 1337 and forcing a manual "Switch network" click every time.
  let currentChainId = parseInt(import.meta.env.VITE_HEGOTA_CHAIN_ID ?? "3151908");
  const listeners: Record<string, Set<Listener>> = {};
  providerListeners = listeners;

  async function rpc(method: string, params: unknown[]): Promise<unknown> {
    const url = chainRpc[currentChainId];
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const json = await res.json();
    if (json.error) {
      const err = new Error(json.error.message ?? JSON.stringify(json.error)) as Error & { code?: unknown; data?: unknown };
      err.code = json.error.code;
      err.data = json.error.data;
      throw err;
    }
    return json.result;
  }

  const ethereum = {
    isMetaMask: true,
    __isHegotaAutoWallet: true,
    selectedAddress: currentWallet().address,
    chainId: hexChainId(currentChainId),
    on(event: string, cb: Listener) {
      (listeners[event] ??= new Set()).add(cb);
    },
    removeListener(event: string, cb: Listener) {
      listeners[event]?.delete(cb);
    },
    async request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
      const p = params ?? [];
      console.log("[autowallet]", method, p);
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [currentWallet().address];
        case "eth_chainId":
          return hexChainId(currentChainId);
        case "wallet_switchEthereumChain":
        case "wallet_addEthereumChain": {
          const id = parseInt((p[0] as { chainId: string }).chainId, 16);
          currentChainId = id;
          listeners["chainChanged"]?.forEach((cb) => cb(hexChainId(id)));
          return null;
        }
        case "personal_sign": {
          const [message] = p as [string];
          const bytes = isHexString(message) ? getBytes(message) : message;
          return currentWallet().signMessage(bytes);
        }
        case "eth_signTypedData_v4": {
          const [, typedDataStr] = p as [string, string];
          const typedData = JSON.parse(typedDataStr);
          const { types, domain, message } = typedData;
          const { EIP712Domain: _unused, ...restTypes } = types;
          return currentWallet().signTypedData(domain, restTypes, message);
        }
        case "eth_sendTransaction": {
          const [txReq] = p as [Record<string, unknown>];
          const provider = new JsonRpcProvider(chainRpc[currentChainId]);
          const connected = currentWallet().connect(provider);
          const sent = await connected.sendTransaction({
            to: txReq.to as string,
            data: txReq.data as string | undefined,
            value: txReq.value as string | undefined,
            gasLimit: txReq.gas as string | undefined,
          });
          return sent.hash;
        }
        default:
          return rpc(method, p);
      }
    },
  };
  ethereumRef = ethereum;

  (window as unknown as { ethereum: unknown }).ethereum = ethereum;

  const info = { uuid: "auto-wallet-stub", name: "Demo Wallet (no funds needed)", icon: AUTO_WALLET_ICON, rdns: "dev.autowallet" };
  function announce() {
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider: ethereum }) }));
  }
  window.addEventListener("eip6963:requestProvider", announce);
  announce();

  console.log(
    "[autowallet] installed:",
    wallets.map((w) => w.address),
    "active:",
    currentWallet().address,
  );
}
