// Browser-level end-to-end check of the deployed Hegotá demo.
//
// `scripts/verify-demo-e2e.mjs` drives the contracts directly with the relay key. That proves the
// chain and the contracts work, but it never touches the app, so it cannot tell you whether a
// visitor can actually complete a scenario. This drives the real UI: it connects through the
// built-in demo wallet (announced over EIP-6963, so no extension is needed), then arms each
// scenario and asserts on the verdict the visitor sees.
//
// The assertions mirror what each scenario is designed to demonstrate, per WalletSimulatorPanel:
// `revertedByDesign = outcome === "reverted" && (triggerAttacker || violationEnabled)`.
//   - the four `violationToggle` scenarios offer compliant and attack variants: compliant must
//     confirm, attack must be caught by the POST_TX assertion
//   - the two swap scenarios have no toggle; they offer two submit buttons instead, and the
//     "(With attack)" one runs an attacker bot between the quote and execution
// A plain "Transaction reverted" (no violation armed) or "Transaction excluded" (no receipt inside
// the app's ~40s poll window) is a failure in either shape.
//
// The UI verdict alone is not enough for the attack runs. "Attack caught" only means the
// transaction reverted while a violation was armed -- it does not check that the POST_TX assertion
// is what reverted. When the Hidden ETH Drain subject contract ran out of ETH, its action frame
// reverted on both variants, and the attack run still reported "Attack caught" while demonstrating
// nothing. So the attack tests also read the receipt and require the assertion frame to be the one
// that failed, with the action frame having succeeded first.
//
// Single-worker by necessity: every run is sponsored by the same relay key and reads nonces
// from "latest", so two in flight collide on the nonce.

import { test, expect } from "@playwright/test";

const URL = process.env.DEMO_URL ?? "https://eip7906.forshtat.com";
const FAUCET = process.env.DEMO_FAUCET ?? "https://faucet.hegota.ethrex.xyz";

const CAUGHT = "Attack caught — transaction reverted";
const SUCCEEDED = "Frames succeeded";
const MISMATCH = "Transaction reverted";
const EXCLUDED = "Transaction excluded";
const ANY_VERDICT = new RegExp([CAUGHT, SUCCEEDED, MISMATCH, EXCLUDED].join("|"));

// `toggle`: the scenario exposes compliant and attack buttons.
// `attacker`: no toggle; a quote step runs first and an attacker bot moves the price.
const SCENARIOS = [
  { path: "/unlimited-approval", name: "Unlimited approval", kind: "toggle" },
  { path: "/hidden-eth-drain", name: "Hidden ETH drain", kind: "toggle" },
  { path: "/proxy-swap", name: "Proxy implementation swap", kind: "toggle" },
  { path: "/control-plane-takeover", name: "Control-plane takeover", kind: "toggle" },
  { path: "/mev-sandwich", name: "MEV sandwich", kind: "attacker" },
  { path: "/oracle-manipulation", name: "Oracle manipulation", kind: "attacker" },
];

// A scenario is armable only while `erc7579.isDeployed && erc7579.isFunded`. Each run spends the
// account's input-token balance, so after a couple of runs the gate closes and every later
// scenario looks broken for an unrelated reason. Step 2 restores it, and its button stays
// clickable whenever the account is deployed, so this is safe to repeat.
async function topUp(page) {
  await page.goto(URL + "/account-setup", { waitUntil: "networkidle" });
  const fund = page.getByRole("button", { name: /Fund & approve|Confirm in wallet/i }).first();
  await expect(fund).toBeEnabled({ timeout: 60_000 });
  await fund.click();
  await expect(page.getByRole("button", { name: "Fund & approve" }).first()).toBeEnabled({ timeout: 180_000 });
}

async function arm(page, path, variant) {
  const name = variant === "single"
    ? /^Try it with your wallet$/
    : new RegExp(`Try it with your wallet \\(${variant}\\)`, "i");
  await page.goto(URL + path, { waitUntil: "networkidle" });
  let button = page.getByRole("button", { name }).first();

  // One top-up is not always enough: step 2 sends a fixed amount, and a long run can drain the
  // account faster than a single call restores it. Retry rather than reporting a funding shortfall
  // as an unarmable scenario.
  for (let i = 0; i < 3 && !(await button.isEnabled().catch(() => false)); i++) {
    await topUp(page);
    await page.goto(URL + path, { waitUntil: "networkidle" });
    button = page.getByRole("button", { name }).first();
  }
  await expect(
    button,
    `${path} (${variant}) should be armable after topping the account up`,
  ).toBeEnabled({ timeout: 30_000 });
  await button.click();
}

// `submitName` must be exact: a scenario with an attacker renders "Submit transaction (Without
// attack)" and "(With attack)", and a loose "Submit transaction" match silently picks the
// without-attack button -- which then succeeds, exactly as it should, while looking like the
// attack went uncaught.
async function signAndSubmit(page, submitName = /^Submit transaction$/) {
  let txHash = null;
  page.on("response", async (res) => {
    if (!/rpc1\.hegota/.test(res.url())) return;
    try {
      const req = JSON.parse(res.request().postData() ?? "{}");
      if (req.method === "eth_sendRawTransaction") {
        const body = await res.json();
        if (body.result) txHash = body.result;
      }
    } catch {
      // not the call we are after
    }
  });

  // The swap scenarios quote the live pool first; the device shows nothing to sign until then.
  const simulate = page.getByRole("button", { name: "Simulate" }).first();
  if (await simulate.isVisible().catch(() => false)) {
    await simulate.click();
    await expect(simulate).toBeHidden({ timeout: 120_000 });
  }
  await page.getByRole("button", { name: "Approve with wallet" }).first().click();
  const submit = page.getByRole("button", { name: submitName }).first();
  await expect(submit).toBeEnabled({ timeout: 120_000 });
  await submit.click();

  const verdict = page.locator(".MuiChip-root", { hasText: ANY_VERDICT }).first();
  await expect(verdict).toBeVisible({ timeout: 150_000 });

  const receipt = txHash
    ? await page.evaluate(async (h) => {
        const r = await fetch("https://rpc1.hegota.ethrex.xyz", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [h] }),
        });
        return (await r.json()).result;
      }, txHash)
    : null;

  return { verdict: (await verdict.innerText()).trim(), frames: (receipt?.frameReceipts ?? []).map((f) => f.status), txHash };
}

// Not `serial`: `workers: 1` already sequences these, and each scenario tops itself up, so they
// are independent. Serial mode would skip every later scenario after the first failure and hide
// whatever else is broken.

test("the site loads without console errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(URL, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading").first()).toBeVisible();
  expect(errors, `console errors: ${errors.join(" | ")}`).toHaveLength(0);
});

// Every scenario submits a self-verify frame transaction, so the sender pays its own maxCost and a
// visitor with no ETH cannot run anything. The faucet button is the only route the app offers, and
// its failure surfaces as an opaque "validation prefix frame reverted" at submit time rather than
// as anything about funding, so it is worth checking on its own.
test("the faucet can fund a visitor who arrives with nothing", async ({ request }) => {
  const address = "0x" + "e2e0".repeat(10);
  const res = await request.post(`${FAUCET}/api/claim`, { data: { address }, failOnStatusCode: false });
  expect(
    res.status(),
    `faucet returned ${res.status()}: ${await res.text()}. It is rate limited per source IP, ` +
      `so anyone sharing an address with a recent claimant cannot fund a wallet, and every ` +
      `scenario then fails at submit with "validation prefix frame reverted".`,
  ).toBeLessThan(400);
});

for (const { path, name, kind } of SCENARIOS) {
  const toggle = kind === "toggle";

  test(`${name}: a clean run confirms`, async ({ page }) => {
    await arm(page, path, toggle ? "compliant" : "single");
    const { verdict, frames, txHash } = await signAndSubmit(
      page, toggle ? undefined : /^Submit transaction \(Without attack\)$/);
    expect(verdict, `${name} clean verdict (${txHash}, frames ${frames.join(",")})`).toBe(SUCCEEDED);
  });

  test(`${name}: the attack is caught by the assertion`, async ({ page }) => {
    await arm(page, path, toggle ? "attack" : "single");
    const { verdict, frames, txHash } = await signAndSubmit(
      page, toggle ? undefined : /^Submit transaction \(With attack\)$/);
    expect(verdict, `${name} attack verdict (${txHash})`).toBe(CAUGHT);

    // The POST_TX assertion is the last frame. It must be the one that reverted, and every frame
    // before it must have succeeded -- otherwise the action failed for its own reasons and the
    // assertion never got to prove anything.
    expect(frames.length, `${name}: no frame receipts for ${txHash}`).toBeGreaterThan(1);
    expect(frames.at(-1), `${name}: assertion frame should revert (${txHash}, frames ${frames.join(",")})`).toBe("0x0");
    expect(frames.slice(0, -1), `${name}: frames before the assertion should succeed (${txHash})`)
      .toEqual(frames.slice(0, -1).map(() => "0x1"));
  });
}
