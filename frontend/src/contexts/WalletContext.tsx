import React, { createContext, useContext, useEffect, useState } from "react";
import { BrowserProvider, type JsonRpcSigner } from "ethers";
import { useAppKitProvider, useAppKitAccount, useAppKitNetwork } from "@reown/appkit/react";
import type { Eip1193Provider } from "ethers";
import type { AppKitNetwork } from "@reown/appkit/networks";
import { ethrexNetwork, hegotaNetwork } from "../wallet.js";
import { formatWalletError } from "../errorFormat.js";
import { registerEnsName } from "../ensLabels.js";

const EXPECTED_CHAIN_ID = parseInt(import.meta.env.VITE_CHAIN_ID ?? "1337");
export const HEGOTA_CHAIN_ID = parseInt(import.meta.env.VITE_HEGOTA_CHAIN_ID ?? "3151908");

function buildAddChainParams(network: AppKitNetwork) {
  return {
    chainId: `0x${Number(network.id).toString(16)}`,
    chainName: network.name,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: network.rpcUrls?.default?.http ?? [],
    blockExplorerUrls: network.blockExplorers?.default?.url ? [network.blockExplorers.default.url] : undefined,
  };
}

interface WalletContextValue {
  signer: JsonRpcSigner | null;
  // Callers that don't need a signer should use this instead of `signer.provider`.
  provider: BrowserProvider | null;
  address: string | null;
  isConnected: boolean;
  chainId: number | undefined;
  isCorrectChain: boolean;
  // TXTRACE/EVENTDATACOPY only work on Hegotá inside a POST_TX frame, so none of the
  // ordinary-transaction demos in this app work when connected there.
  isHegota: boolean;
  switchToEthrex(): Promise<void>;
  switchToHegota(): Promise<void>;
  isSwitchingNetwork: boolean;
  switchNetworkError: string | null;
  addHegotaNetwork(): Promise<void>;
  isAddingNetwork: boolean;
  addNetworkError: string | null;
  // True when the connected provider is the dev-only injected-provider stub (devAutoWallet.ts),
  // not a real wallet extension -- gates UI that can only ever control that stub's own accounts.
  isDevAutoWallet: boolean;
}

const WalletContext = createContext<WalletContextValue>({
  signer: null,
  provider: null,
  address: null,
  isConnected: false,
  chainId: undefined,
  isCorrectChain: false,
  isHegota: false,
  switchToEthrex: async () => {},
  switchToHegota: async () => {},
  isSwitchingNetwork: false,
  switchNetworkError: null,
  addHegotaNetwork: async () => {},
  isAddingNetwork: false,
  addNetworkError: null,
  isDevAutoWallet: false,
});

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { walletProvider }    = useAppKitProvider<Eip1193Provider>("eip155");
  const { address, isConnected } = useAppKitAccount();
  const { chainId, switchNetwork } = useAppKitNetwork();
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [isSwitchingNetwork, setIsSwitchingNetwork] = useState(false);
  const [switchNetworkError, setSwitchNetworkError] = useState<string | null>(null);
  const [isAddingNetwork, setIsAddingNetwork] = useState(false);
  const [addNetworkError, setAddNetworkError] = useState<string | null>(null);
  // AppKit's own `chainId` (from useAppKitNetwork above) does not reliably update after a
  // switchNetwork() call resolves -- the wallet's own chain genuinely changes but AppKit's
  // React state can stay on the old chain. Tracked independently here via the raw provider's
  // own chainChanged event, which every EIP-1193 provider emits reliably regardless.
  const [liveChainId, setLiveChainId] = useState<number | undefined>(undefined);
  // ethers' JsonRpcSigner fixes its address at construction (immutable) -- without this, an
  // account switch would leave `signer` silently bound to the old address even after AppKit's
  // own `address` moves on.
  const [liveAddress, setLiveAddress] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!walletProvider) {
      setLiveChainId(undefined);
      return;
    }
    let cancelled = false;
    walletProvider.request({ method: "eth_chainId" }).then((hex) => {
      if (!cancelled) setLiveChainId(parseInt(hex as string, 16));
    });
    const eventfulProvider = walletProvider as unknown as {
      on?: (event: string, cb: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
    };
    const handleChainChanged = (hex: unknown) => setLiveChainId(parseInt(hex as string, 16));
    eventfulProvider.on?.("chainChanged", handleChainChanged);
    return () => {
      cancelled = true;
      eventfulProvider.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [walletProvider]);

  useEffect(() => {
    if (!walletProvider) {
      setLiveAddress(undefined);
      return;
    }
    let cancelled = false;
    walletProvider.request({ method: "eth_accounts" }).then((accounts) => {
      if (!cancelled) setLiveAddress((accounts as string[])[0]);
    });
    const eventfulProvider = walletProvider as unknown as {
      on?: (event: string, cb: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
    };
    const handleAccountsChanged = (accounts: unknown) => setLiveAddress((accounts as string[])[0]);
    eventfulProvider.on?.("accountsChanged", handleAccountsChanged);
    return () => {
      cancelled = true;
      eventfulProvider.removeListener?.("accountsChanged", handleAccountsChanged);
    };
  }, [walletProvider]);

  // Keyed off `liveAddress` (not AppKit's own `address`) since it's the one that actually
  // updates on devAutoWallet's accountsChanged switch.
  useEffect(() => {
    if (liveAddress) registerEnsName(liveAddress, "you.eth");
  }, [liveAddress]);

  useEffect(() => {
    if (!walletProvider || !isConnected) {
      setSigner(null);
      setProvider(null);
      return;
    }

    const loggingProvider: Eip1193Provider = {
      request(args) {
        let patchedArgs = args;

        // ethrex bug workaround: ethrex incorrectly validates nonces on eth_call when
        // a `from` field is present -- it treats the simulated call like a real transaction
        // and rejects it with "Nonce mismatch" if the account nonce has advanced. The EVM
        // spec does not require `from` for a read-only call, so we strip it before forwarding.
        if (
          args.method === "eth_call" &&
          Array.isArray(args.params) &&
          (args.params[0] as Record<string, unknown>)?.from
        ) {
          const [tx, ...rest] = args.params as [Record<string, unknown>, ...unknown[]];
          const { from: strippedFrom, ...txWithoutFrom } = tx;
          patchedArgs = { ...args, params: [txWithoutFrom, ...rest] };
          console.warn(
            `[RPC] eth_call: stripped 'from' (${String(strippedFrom)}) — ethrex nonce-validation bug workaround`,
          );
        }

        console.group(`[RPC] → ${patchedArgs.method}`);
        console.log("params:", patchedArgs.params);
        const result = walletProvider.request(patchedArgs);
        result
          .then((r) => console.log("result:", r))
          .catch((e) => console.error("error:", e))
          .finally(() => console.groupEnd());
        return result;
      },
    };

    const browserProvider = new BrowserProvider(loggingProvider);
    setProvider(browserProvider);
    browserProvider.getSigner().then(setSigner).catch(() => setSigner(null));
    // liveChainId and liveAddress are included so a network or account switch mid-session
    // recreates the provider/signer -- otherwise ethers' network-change safety check
    // permanently throws NETWORK_ERROR on every subsequent tx/receipt call for the session.
  }, [walletProvider, isConnected, liveChainId, liveAddress]);

  const effectiveChainId = liveChainId ?? (chainId !== undefined ? Number(chainId) : undefined);
  const isCorrectChain = isConnected && effectiveChainId === EXPECTED_CHAIN_ID;
  const isHegota = isConnected && effectiveChainId === HEGOTA_CHAIN_ID;
  const isDevAutoWallet = Boolean(
    (walletProvider as unknown as { __isHegotaAutoWallet?: boolean } | undefined)?.__isHegotaAutoWallet,
  );

  async function readLiveChainId(): Promise<number | null> {
    if (!walletProvider) return null;
    const hex = (await walletProvider.request({ method: "eth_chainId" })) as string;
    const id = parseInt(hex, 16);
    setLiveChainId(id);
    return id;
  }

  async function switchNetworkTo(target: AppKitNetwork) {
    setIsSwitchingNetwork(true);
    setSwitchNetworkError(null);
    try {
      await switchNetwork?.(target);
      // AppKit's switchNetwork() can resolve having made *no* underlying
      // wallet_switchEthereumChain request at all for some connectors, silently leaving the
      // wallet on the old chain -- re-read the chain from the provider itself rather than
      // trusting the promise.
      if ((await readLiveChainId()) === target.id) return;

      // Fall back to a direct EIP-3085 wallet_addEthereumChain call -- wallets treat "add" as
      // "add-and-switch" (or just "switch" if the chain is already known), so this reliably
      // switches even when AppKit's own switchNetwork silently does nothing.
      if (walletProvider) {
        await walletProvider.request({
          method: "wallet_addEthereumChain",
          params: [buildAddChainParams(target)],
        });
        if ((await readLiveChainId()) === target.id) return;
      }

      throw new Error(
        `Wallet did not switch to ${target.name} (chain ${target.id}) after being asked directly. It may not support switching to this network.`,
      );
    } catch (e) {
      setSwitchNetworkError(formatWalletError(e));
    } finally {
      setIsSwitchingNetwork(false);
    }
  }

  async function switchToEthrex() {
    await switchNetworkTo(ethrexNetwork);
  }

  async function switchToHegota() {
    await switchNetworkTo(hegotaNetwork);
  }

  async function addHegotaNetwork() {
    if (!walletProvider) return;
    setIsAddingNetwork(true);
    setAddNetworkError(null);
    try {
      await walletProvider.request({
        method: "wallet_addEthereumChain",
        params: [buildAddChainParams(hegotaNetwork)],
      });
      await readLiveChainId();
    } catch (e) {
      setAddNetworkError(formatWalletError(e));
    } finally {
      setIsAddingNetwork(false);
    }
  }

  return (
    <WalletContext.Provider value={{
      signer,
      provider,
      address: address ?? null,
      isConnected,
      chainId: effectiveChainId,
      isCorrectChain,
      isHegota,
      switchToEthrex,
      switchToHegota,
      isSwitchingNetwork,
      switchNetworkError,
      addHegotaNetwork,
      isAddingNetwork,
      addNetworkError,
      isDevAutoWallet,
    }}>
      {children}
    </WalletContext.Provider>
  );
}

export const useWallet = () => useContext(WalletContext);
