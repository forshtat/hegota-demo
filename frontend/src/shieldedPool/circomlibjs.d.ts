// circomlibjs ships no TypeScript types. Minimal ambient declaration for the one function
// this codebase actually calls (frontend/src/shieldedPool/poseidon.ts) -- not a full API
// surface.
declare module "circomlibjs" {
  export interface PoseidonField {
    e(x: bigint): unknown;
    toString(x: unknown): string;
  }
  export interface PoseidonFn {
    (inputs: unknown[]): unknown;
    F: PoseidonField;
  }
  export function buildPoseidon(): Promise<PoseidonFn>;
}
