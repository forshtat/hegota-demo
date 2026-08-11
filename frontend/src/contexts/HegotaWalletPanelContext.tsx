// Persistent-panel state for the wallet-simulator drawer. Any attack page, or Private Swap's
// own shield/withdraw scenarios, can `arm(scenario)` to slide the drawer open; the panel
// auto-disarms when the user navigates away from the page that armed it, so a stale scenario
// never lingers into an unrelated page.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { HegotaWalletScenario } from "../hegotaScenarios/types.js";
import type { FrameTxPlan, PostTxRunResult } from "../hegotaWallet.js";

// There is physically one right-hand drawer, so this is a single discriminant rather than
// competing "isOpen" booleans.
export type HegotaWalletPanelMode = "scenario" | "accountPicker" | "provisioning" | null;

/** Drives ProvisioningPanel.tsx -- the self-funded-provisioning counterpart to a scenario's
 *  own quote/prepare/buildFrames, but much smaller: provisioning has no quote, no separate
 *  inner-authorization step, and no violation toggle, so it doesn't need
 *  HegotaWalletScenario's full shape. `prepare` does whatever async host-side work a given
 *  provisioning step needs (a faucet claim + balance wait for account deploy, nothing at all
 *  for a bare self_verify) and returns the frame tx plan to review/sign; the panel itself
 *  handles the actual submitFrameTx call once the user approves what it shows. */
export interface ProvisioningTask {
  title: string;
  prepare(reportProgress: (label: string) => Promise<void>): Promise<{ plan: FrameTxPlan; signerAddress: string }>;
  onResult(result: PostTxRunResult): void;
  // Called instead of onResult if prepare() itself throws (e.g. the faucet claim fails) --
  // no frame tx was ever built, so there's no PostTxRunResult to report. Without this, a
  // caller that only clears its own "busy" state from onResult would stay stuck showing
  // "Confirm..."/disabled forever after a prepare-time failure, since onResult never fires.
  onPrepareError(error: unknown): void;
}

interface HegotaWalletPanelContextValue {
  isOpen: boolean;
  mode: HegotaWalletPanelMode;
  scenario: HegotaWalletScenario<any> | null;
  options: { triggerViolation?: boolean } | null;
  provisioningTask: ProvisioningTask | null;
  // Increments on every arm()/armAccountPicker()/armProvisioning() call, even re-arming the
  // same scenario/task. Consumers should key off this instead of `scenario`/`provisioningTask`
  // identity, which doesn't change on a same-button re-click and so doesn't reset stale state
  // from the previous run.
  armId: number;
  arm(scenario: HegotaWalletScenario<any>, options?: { triggerViolation?: boolean }): void;
  armAccountPicker(): void;
  armProvisioning(task: ProvisioningTask): void;
  disarm(): void;
}

const HegotaWalletPanelContext = createContext<HegotaWalletPanelContextValue>({
  isOpen: false,
  mode: null,
  scenario: null,
  options: null,
  provisioningTask: null,
  armId: 0,
  arm: () => {},
  armAccountPicker: () => {},
  armProvisioning: () => {},
  disarm: () => {},
});

export function HegotaWalletPanelProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [mode, setMode] = useState<HegotaWalletPanelMode>(null);
  const [scenario, setScenario] = useState<HegotaWalletScenario<any> | null>(null);
  const [options, setOptions] = useState<{ triggerViolation?: boolean } | null>(null);
  const [provisioningTask, setProvisioningTask] = useState<ProvisioningTask | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [armId, setArmId] = useState(0);
  const armedFromPath = useRef<string | null>(null);

  function arm(next: HegotaWalletScenario<any>, opts?: { triggerViolation?: boolean }) {
    armedFromPath.current = location.pathname;
    setMode("scenario");
    setScenario(next);
    setOptions(opts ?? null);
    setProvisioningTask(null);
    setIsOpen(true);
    setArmId((id) => id + 1);
  }

  function armAccountPicker() {
    armedFromPath.current = location.pathname;
    setMode("accountPicker");
    setScenario(null);
    setOptions(null);
    setProvisioningTask(null);
    setIsOpen(true);
    setArmId((id) => id + 1);
  }

  function armProvisioning(task: ProvisioningTask) {
    armedFromPath.current = location.pathname;
    setMode("provisioning");
    setScenario(null);
    setOptions(null);
    setProvisioningTask(task);
    setIsOpen(true);
    setArmId((id) => id + 1);
  }

  function disarm() {
    armedFromPath.current = null;
    setMode(null);
    setScenario(null);
    setOptions(null);
    setProvisioningTask(null);
    setIsOpen(false);
  }

  useEffect(() => {
    if (armedFromPath.current !== null && location.pathname !== armedFromPath.current) {
      disarm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <HegotaWalletPanelContext.Provider
      value={{ isOpen, mode, scenario, options, provisioningTask, armId, arm, armAccountPicker, armProvisioning, disarm }}
    >
      {children}
    </HegotaWalletPanelContext.Provider>
  );
}

export const useHegotaWalletPanel = () => useContext(HegotaWalletPanelContext);
