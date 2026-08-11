// Connect once, fund the demo wallet, provision both accounts, and save the browser state so
// every scenario test starts from a ready wallet instead of re-provisioning (each fresh context
// generates new autowallet keys, which would mean a new account + a new faucet claim per test).
//
// Funding does NOT go through the app's faucet button: that endpoint is IP rate-limited to
// roughly one claim an hour, so a suite that used it would fail on its second test. A prefunded
// devnet account transfers directly instead. The faucet button is still exercised separately as
// its own health check.

import { chromium } from "@playwright/test";
import { JsonRpcProvider, HDNodeWallet, Mnemonic, Wallet, parseEther } from "ethers";

const URL = process.env.DEMO_URL ?? "https://eip7906.forshtat.com";
const RPC = process.env.DEMO_RPC_URL ?? "https://rpc1.hegota.ethrex.xyz";
// The public kurtosis devnet mnemonic. Its accounts are prefunded on this devnet and the phrase
// is a well-known test vector, not a secret. Override with DEMO_FUNDER_KEY to use another account.
const MNEMONIC =
  "giant issue aisle success illegal bike spike question tent bar rely arctic volcano long crawl hungry vocal artwork sniff fantasy very lucky have athlete";

export default async function globalSetup() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();

  await page.goto(URL, { waitUntil: "networkidle", timeout: 60_000 });
  await page.locator("appkit-button").first().click();
  await page.getByText("Demo Wallet (no funds needed)").click();
  await page.waitForTimeout(3000);

  const [addr] = await page.evaluate(() => window.ethereum.request({ method: "eth_accounts" }));
  if (!addr) throw new Error("demo wallet did not connect");

  const provider = new JsonRpcProvider(RPC);
  const funder = process.env.DEMO_FUNDER_KEY
    ? new Wallet(process.env.DEMO_FUNDER_KEY, provider)
    : HDNodeWallet.fromMnemonic(Mnemonic.fromPhrase(MNEMONIC), "m/44'/60'/0'/0/1").connect(provider);
  await (await funder.sendTransaction({ to: addr, value: parseEther("10") })).wait();
  console.log(`  [setup] funded ${addr} with 10 ETH`);

  await page.goto(URL + "/account-setup", { waitUntil: "networkidle" });
  // Scope each status chip to its own step card. Steps 1 and 3 both report "Deployed", so an
  // unscoped lookup matches step 1's chip and step 3 reports success without ever running --
  // which then shows up much later as the Safe scenario being permanently unarmable.
  for (const [step, button, chip] of [
    ["Step 1 — Provision your smart account", "Set up my account", "Deployed"],
    ["Step 2 — Fund & approve", "Fund & approve", "Funded & approved"],
    ["Step 3 — Provision your personal demo Safe", "Set up my Safe", "Deployed"],
  ]) {
    const card = page.locator(".MuiPaper-root").filter({ hasText: step }).last();
    const btn = card.getByRole("button", { name: button }).first();
    await btn.waitFor({ state: "visible", timeout: 60_000 });
    for (let i = 0; i < 60 && (await btn.isDisabled()); i++) await page.waitForTimeout(2000);
    if (await btn.isDisabled()) throw new Error(`setup step "${button}" never became enabled`);
    await btn.click();
    await card.getByText(chip, { exact: true }).first().waitFor({ state: "visible", timeout: 180_000 });
    console.log(`  [setup] ${button}: ${chip}`);
  }

  await ctx.storageState({ path: "e2e/.auth/state.json" });
  await browser.close();
}
