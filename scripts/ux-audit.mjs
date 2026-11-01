/* pnpm ux:audit
 * Crawls the signed-in and public pages of a running app at desktop and phone width, runs axe-core (WCAG A/AA + best practice),
 * flags horizontal overflow, and saves full-page screenshots to ./storage/ux-audit/ for a visual review.
 * Needs the seeded demo account (pnpm db:seed) and the app running. BASE=http://localhost:3000 by default.
 * Exit code 1 when any violation or overflow is found. */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const BASE = process.env.BASE ?? "http://localhost:3000";
const EMAIL = process.env.AUDIT_EMAIL ?? "demo@kudobird.local";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "demo-password-123";
const OUT = "storage/ux-audit";
const axeSrc = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const problems = [];
for (const [vp, width, height] of [["desktop", 1360, 860], ["phone", 390, 800]]) {
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  const scan = async (path) => {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${OUT}/${vp}-${path.replace(/[^a-z0-9]+/gi, "_").slice(0, 60) || "home"}.png`, fullPage: true });
    await page.evaluate(axeSrc);
    const violations = await page.evaluate(async () => (await axe.run({ runOnly: ["wcag2a", "wcag2aa", "wcag22aa", "best-practice"] })).violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes[0].target.join(" ")}`));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2);
    for (const v of violations) problems.push(`${vp} ${path}: ${v}`);
    if (overflow) problems.push(`${vp} ${path}: horizontal scroll`);
    console.log(`${vp.padEnd(7)} ${path.padEnd(60)} ${violations.length || overflow ? "ISSUES" : "ok"}`);
  };
  for (const p of ["/", "/login", "/signup", "/forgot", "/verify-email?email=someone@example.org"]) await scan(p);
  await page.goto(BASE + "/login");
  await page.fill("[name=email]", EMAIL); await page.fill("[name=password]", PASSWORD);
  await page.click('button:has-text("Sign in")'); await page.waitForURL("**/app");
  const pages = ["/app", "/app/campaigns", "/app/signatories", "/app/members", "/app/developers", "/app/settings", "/app/audit"];
  await page.goto(BASE + "/app/campaigns");
  const first = await page.locator('a[href^="/app/campaigns/"]').first().getAttribute("href");
  if (first) for (const tab of ["", "/form", "/design", "/entries", "/bulk"]) pages.push(first + tab);
  if (first) { // a public certificate page, taken from the first entry that has one
    await page.goto(BASE + first + "/entries");
    const cert = await page.locator('a[href^="/c/"]').first().getAttribute("href").catch(() => null);
    if (cert) pages.push(cert);
  }
  for (const p of pages) await scan(p);
}
await browser.close();
if (problems.length) { console.error("\n" + problems.join("\n")); process.exit(1); }
console.log("\nNo accessibility violations or overflow found.");
