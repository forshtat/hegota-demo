// Connect once, fund the demo wallet, provision both accounts, and save the browser state so
// every scenario test starts from a ready wallet instead of re-provisioning (each fresh context
// generates new autowallet keys, which would mean a new account per test).
//
// Funding comes from a prefunded devnet account rather than the public faucet, which is rate
// limited per source IP and would make the suite unrunnable from any address that claimed
// recently. Provisioning calls that faucet itself, so the claim endpoint is served locally too
// (see the route below) -- the money moves for real, only the rate-limited hop is replaced. The
// faucet is still checked on its own in demo.spec.mjs.

import { chromium } from "@playwright/test";
import { JsonRpcProvider, HDNodeWallet, Mnemonic, Wallet, parseEther } from "ethers";

const URL = process.env.DEMO_URL ?? "https://eip7906.forshtat.com";
const RPC = process.env.DEMO_RPC_URL ?? "https://rpc1.hegota.ethrex.xyz";
// The public kurtosis devnet mnemonic. Its accounts are prefunded on this devnet and the phrase
// is a well-known test vector, not a secret. Override with DEMO_FUNDER_KEY to use another account.
const MNEMONIC =
  "giant issue aisle success illegal bike spike question tent bar rely arctic volcano long crawl hungry vocal artwork sniff fantasy very lucky have athlete";

const STEPS = [
  {
    title: "Step 1 — Provision your smart account",
    button: "Set up my account",
    chip: "Deployed",
    required: true,
  },
  {
    title: "Step 2 — Fund & approve",
    button: "Fund & approve",
    chip: "Funded & approved",
    required: true,
  },
  {
    // Only the Control-Plane Takeover scenario needs the Safe, and this step submits a self-paid
    // frame transaction that can revert on its own. Treat it as best effort: a failure here should
    // surface as that one scenario failing, not as the whole suite refusing to start.
    title: "Step 3 — Provision your personal demo Safe",
    button: "Set up my Safe",
    chip: "Deployed",
    required: false,
  },
];

// Poll for the step's own success chip AND for an error alert in the same card. Waiting only for
// the chip turns a step that failed in two seconds into a full-length timeout with no reason
// attached, which is what made setup look flaky rather than broken.
async function settle(page, card, chip, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const done = card.getByText(chip, { exact: true }).first();
  const alerts = card.locator(".MuiAlert-root");
  while (Date.now() < deadline) {
    if (await done.isVisible().catch(() => false)) return { ok: true };
    const count = await alerts.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const text = (await alerts.nth(i).innerText().catch(() => "")).trim();
      if (/revert|failed|error/i.test(text)) return { ok: false, reason: text.replace(/\s+/g, " ") };
    }
    await page.waitForTimeout(2000);
  }
  return { ok: false, reason: `no "${chip}" and no error within ${Math.round(timeoutMs / 1000)}s` };
}

async function runStep(page, step, attempts = 3) {
  // Scope everything to the step's own card. Steps 1 and 3 both report "Deployed", so an unscoped
  // lookup matches step 1's chip and step 3 reports success without ever running -- which then
  // shows up much later as the Safe scenario being permanently unarmable.
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const card = page.locator(".MuiPaper-root").filter({ hasText: step.title }).last();
    const done = card.getByText(step.chip, { exact: true }).first();
    if (await done.isVisible().catch(() => false)) return { ok: true };

    const btn = card.getByRole("button", { name: step.button }).first();
    await btn.waitFor({ state: "visible", timeout: 60_000 });
    for (let i = 0; i < 60 && (await btn.isDisabled()); i++) await page.waitForTimeout(2000);
    if (await btn.isDisabled()) return { ok: false, reason: `"${step.button}" never became enabled` };

    await btn.click();
    const result = await settle(page, card, step.chip, 120_000);
    if (result.ok) return result;

    console.warn(`  [setup] ${step.button} attempt ${attempt}/${attempts} failed: ${result.reason}`);
    if (attempt === attempts) return result;
    // Reload so the next attempt reads fresh on-chain state rather than the failed render.
    await page.reload({ waitUntil: "networkidle" });
  }
  return { ok: false, reason: "exhausted attempts" };
}

export default async function globalSetup() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });

  const provider = new JsonRpcProvider(RPC);
  const funder = process.env.DEMO_FUNDER_KEY
    ? new Wallet(process.env.DEMO_FUNDER_KEY, provider)
    : HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(MNEMONIC), "m/44'/60'/0'/0/1").connect(provider);

  // Provisioning calls the public faucet unconditionally and throws if the claim fails, so a
  // suite running from an IP that claimed recently can never get past step 1 -- and because the
  // claim is rate limited rather than broken, that would be a red run that says nothing about the
  // deployment. Serve the claim locally instead: the transfer is a real on-chain send from a
  // prefunded devnet account to the exact address the app asked for, so everything downstream
  // (balance polling, the self-paid deploy+self_verify frame transaction) stays genuine. Only the
  // rate-limited third-party hop is replaced. The real faucet is still checked in demo.spec.mjs.
  await ctx.route(/faucet\.hegota\.ethrex\.xyz\/api\/claim/, async (route) => {
    let address;
    try {
      ({ address } = JSON.parse(route.request().postData() ?? "{}"));
    } catch {
      return route.fulfill({ status: 400, body: '{"msg":"bad request"}' });
    }
    if (!address) return route.fulfill({ status: 400, body: '{"msg":"no address"}' });
    await (await funder.sendTransaction({ to: address, value: parseEther("2") })).wait();
    console.log(`  [setup] served faucet claim for ${address} (2 ETH)`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ msg: "ok" }),
    });
  });

  const page = await ctx.newPage();

  await page.goto(URL, { waitUntil: "networkidle", timeout: 60_000 });
  await page.locator("appkit-button").first().click();
  await page.getByText("Demo Wallet (no funds needed)").click();
  await page.waitForTimeout(3000);

  const [addr] = await page.evaluate(() => window.ethereum.request({ method: "eth_accounts" }));
  if (!addr) throw new Error("demo wallet did not connect");

  // Step 3 (the Safe) is paid from the connected wallet's own ETH rather than the account's.
  await (await funder.sendTransaction({ to: addr, value: parseEther("10") })).wait();
  console.log(`  [setup] funded ${addr} with 10 ETH`);

  await page.goto(URL + "/account-setup", { waitUntil: "networkidle" });
  for (const step of STEPS) {
    const { ok, reason } = await runStep(page, step);
    if (ok) {
      console.log(`  [setup] ${step.button}: ${step.chip}`);
    } else if (step.required) {
      throw new Error(`setup step "${step.button}" failed: ${reason}`);
    } else {
      console.warn(
        `  [setup] WARNING ${step.button} could not be provisioned (${reason}). ` +
          `Scenarios that need it will fail with that reason.`,
      );
    }
  }

  await ctx.storageState({ path: "e2e/.auth/state.json" });
  await browser.close();
}
