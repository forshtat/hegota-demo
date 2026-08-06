const e = (k: string): string => (import.meta.env[k] as string | undefined) ?? "";

export const ADDRESSES = {
  sudoModule:     e("VITE_SUDO_MODULE"),

  delegationManager: e("VITE_DELEGATION_MANAGER"),

  hybridDelegator: e("VITE_HYBRID_DELEGATOR"),
  testSubject:     e("VITE_TEST_SUBJECT"),
  modularAccount:  e("VITE_MODULAR_ACCOUNT"),
  erc7579Account:  e("VITE_ERC7579_ACCOUNT"),

  slotProtectionEnforcer: e("VITE_SLOT_PROTECTION_ENFORCER"),
  slotProtectionHook6900: e("VITE_SLOT_PROTECTION_HOOK_6900"),
  slotProtectionHook7579: e("VITE_SLOT_PROTECTION_HOOK_7579"),
  minOutputEnforcer:      e("VITE_MIN_OUTPUT_ENFORCER"),
  minOutputHook6900:      e("VITE_MIN_OUTPUT_HOOK_6900"),
  minOutputHook7579:      e("VITE_MIN_OUTPUT_HOOK_7579"),

  ua: {
    token:      e("VITE_UA_TOKEN"),
    enforcerMM: e("VITE_UA_ENFORCER_MM"),
    guardSafe:  e("VITE_UA_GUARD_SAFE"),
    safe:       e("VITE_UA_SAFE"),
    hook6900:   e("VITE_UA_HOOK_6900"),
    hook7579:   e("VITE_UA_HOOK_7579"),
  },

  cpt: {
    safe:      e("VITE_CPT_SAFE"),
    guardSafe: e("VITE_CPT_GUARD_SAFE"),
  },

  hed: {
    legit:      e("VITE_HED_LEGIT"),
    enforcerMM: e("VITE_HED_ENFORCER_MM"),
    guardSafe:  e("VITE_HED_GUARD_SAFE"),
    safe:       e("VITE_HED_SAFE"),
    hook6900:   e("VITE_HED_HOOK_6900"),
    hook7579:   e("VITE_HED_HOOK_7579"),
  },

  mev: {
    token:     e("VITE_MEV_TOKEN"),
    user:      e("VITE_MEV_USER"),
    guardSafe: e("VITE_MEV_GUARD_SAFE"),
    safe:      e("VITE_MEV_SAFE"),
  },

  om: {
    token:     e("VITE_OM_TOKEN"),
    user:      e("VITE_OM_USER"),
    guardSafe: e("VITE_OM_GUARD_SAFE"),
    safe:      e("VITE_OM_SAFE"),
  },

  ps: {
    proxy:     e("VITE_PS_PROXY"),
    safe:      e("VITE_PS_SAFE"),
    guardSafe: e("VITE_PS_GUARD_SAFE"),
  },
} as const;
