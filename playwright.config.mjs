// Browser-level checks against the deployed demo. See e2e/demo.spec.mjs.
export default {
  testDir: "./e2e",
  globalSetup: "./e2e/globalSetup.mjs",
  // Every run is sponsored by the same relay key and reads nonces from "latest", so two in
  // flight collide on the nonce. One worker, and deliberately not `serial` -- each scenario
  // tops itself up, and serial mode would hide every failure after the first.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  timeout: 420_000,
  use: {
    viewport: { width: 1400, height: 1000 },
    storageState: "e2e/.auth/state.json",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
};
