// Persistent-panel state for the wallet-simulator drawer. Any attack page, or Private Swap's
// own shield/withdraw scenarios, can `arm(scenario)` to slide the drawer open; the panel
// auto-disarms when the user navigates away from the page that armed it, so a stale scenario
// never lingers into an unrelated page.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { HegotaWalletScenario } from "../hegotaScenarios/types.js";

// There is physically one right-hand drawer, so this is a single discriminant rather than
// two competing "isOpen" booleans.
export type HegotaWalletPanelMode = "scenario" | "accountPicker" | null;

interface HegotaWalletPanelContextValue {
  isOpen: boolean;
  mode: HegotaWalletPanelMode;
  scenario: HegotaWalletScenario<any> | null;
  options: { triggerViolation?: boolean } | null;
  // Increments on every arm()/armAccountPicker() call, even re-arming the same scenario.
  // Consumers should key off this instead of `scenario` identity, which doesn't change on
  // a same-button re-click and so doesn't reset stale state from the previous run.
  armId: number;
  arm(scenario: HegotaWalletScenario<any>, options?: { triggerViolation?: boolean }): void;
  armAccountPicker(): void;
  disarm(): void;
}

const HegotaWalletPanelContext = createContext<HegotaWalletPanelContextValue>({
  isOpen: false,
  mode: null,
  scenario: null,
  options: null,
  armId: 0,
  arm: () => {},
  armAccountPicker: () => {},
  disarm: () => {},
});

export function HegotaWalletPanelProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [mode, setMode] = useState<HegotaWalletPanelMode>(null);
  const [scenario, setScenario] = useState<HegotaWalletScenario<any> | null>(null);
  const [options, setOptions] = useState<{ triggerViolation?: boolean } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [armId, setArmId] = useState(0);
  const armedFromPath = useRef<string | null>(null);

  function arm(next: HegotaWalletScenario<any>, opts?: { triggerViolation?: boolean }) {
    armedFromPath.current = location.pathname;
    setMode("scenario");
    setScenario(next);
    setOptions(opts ?? null);
    setIsOpen(true);
    setArmId((id) => id + 1);
  }

  function armAccountPicker() {
    armedFromPath.current = location.pathname;
    setMode("accountPicker");
    setScenario(null);
    setOptions(null);
    setIsOpen(true);
    setArmId((id) => id + 1);
  }

  function disarm() {
    armedFromPath.current = null;
    setMode(null);
    setScenario(null);
    setOptions(null);
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
      value={{ isOpen, mode, scenario, options, armId, arm, armAccountPicker, disarm }}
    >
      {children}
    </HegotaWalletPanelContext.Provider>
  );
}

export const useHegotaWalletPanel = () => useContext(HegotaWalletPanelContext);
