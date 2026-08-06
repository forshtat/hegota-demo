// snarkjs ships no TypeScript types. Minimal ambient declaration for the two functions this
// codebase actually calls (frontend/src/shieldedPool/proving.ts) -- not a full API surface.
declare module "snarkjs" {
  export const groth16: {
    fullProve(
      input: object,
      wasmFile: string,
      zkeyFile: string,
    ): Promise<{ proof: unknown; publicSignals: string[] }>;
    exportSolidityCallData(proof: unknown, publicSignals: string[]): Promise<string>;
  };
}
