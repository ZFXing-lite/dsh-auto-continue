/**
 * dsh-auto-continue — browser-half verification (toggle UI).
 *
 * Drives a real DSH Web GUI and asserts the end-to-end contract:
 *   1. the composer's "+" menu carries ONE toggle row labelled 「自动继续」;
 *   2. the row has a slider switch whose thumb shows 「开」/「关」 and slides;
 *   3. the default state is OFF (关, aria-checked=false);
 *   4. clicking the row flips it to ON (开), the thumb slides right, and the
 *      state persists (reopening the menu still shows 开);
 *   5. clicking again flips back to OFF (关);
 *   6. the stock menu items are untouched.
 *
 * Run: node test/menu.probe.mjs [base-url]
 */
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:3098";
/** Optional session id to navigate to (the composer is locked on the hero page
 *  when no routable model/workspace is selected). */
const SESSION_ID = process.argv[3];

const failures = [];
function check(condition, message) {
	if (!condition) failures.push(message);
	return condition;
}

const browser = await chromium.launch({ headless: true });
try {
	const context = await browser.newContext({ viewport: { width: 900, height: 800 } });
	const page = await context.newPage();
	const pageErrors = [];
	page.on("pageerror", (error) => pageErrors.push(String(error).slice(0, 200)));

	await page.goto(BASE + (SESSION_ID ? `/#/session/${SESSION_ID}` : "/"), { waitUntil: "domcontentloaded" });
	await page.waitForSelector("[data-composer-card] button[aria-haspopup=menu]", { timeout: 45_000 });
	await page.waitForTimeout(1200);

	/** Open the "+" menu and return the toggle row's state. */
	async function openMenu() {
		const plus = page.locator("[data-composer-card] button[aria-haspopup=menu]").first();
		if ((await plus.getAttribute("aria-expanded")) !== "true") await plus.click();
		await page.waitForSelector('[data-composer-card] [role="menu"]', { timeout: 10_000 });
		await page.waitForTimeout(350);
		return page.evaluate(() => {
			const menu = document.querySelector('[data-composer-card] [role="menu"]');
			if (menu === null) return null;
			const rows = [...menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')].map((node) => ({
				text: (node.textContent ?? "").trim(),
				ours: node.hasAttribute("data-auto-continue-item"),
				role: node.getAttribute("role"),
				checked: node.getAttribute("aria-checked"),
				disabled: node.disabled === true,
				height: Math.round(node.getBoundingClientRect().height),
			}));
			// Inspect the switch thumb of our row.
			const ours = menu.querySelector("[data-auto-continue-item]");
			const thumb = ours?.querySelector(".ac_thumb");
			const track = ours?.querySelector(".ac_switch");
			const thumbBox = thumb?.getBoundingClientRect();
			const trackBox = track?.getBoundingClientRect();
			return {
				rows,
				thumbText: thumb?.textContent ?? null,
				thumbLeft: thumbBox ? Math.round(thumbBox.left - (trackBox?.left ?? 0)) : null,
				trackWidth: trackBox ? Math.round(trackBox.width) : null,
			};
		});
	}

	async function clickToggle() {
		await page.locator("[data-composer-card] [role='menuitemcheckbox']").first().click();
		await page.waitForTimeout(700);
	}

	// 1 + 2 + 3 — one toggle row, default OFF, thumb shows 关 on the left.
	const first = await openMenu();
	check(first !== null, "the + menu never opened");
	const ours = (first?.rows ?? []).filter((row) => row.ours);
	check(ours.length === 1, `expected 1 toggle row, saw ${String(ours.length)}`);
	check(ours[0]?.text.includes("自动继续"), `row label wrong: ${JSON.stringify(ours[0]?.text)}`);
	check(ours[0]?.role === "menuitemcheckbox", `role is ${String(ours[0]?.role)} (expected menuitemcheckbox)`);
	check(ours[0]?.checked === "false", `default should be OFF (aria-checked=false), got ${String(ours[0]?.checked)}`);
	check(first?.thumbText === "关", `default thumb text should be 关, got ${String(first?.thumbText)}`);
	check((first?.thumbLeft ?? 99) <= 6, `thumb should sit left when off (left=${String(first?.thumbLeft)})`);
	check(ours[0]?.disabled === false, `toggle is disabled: ${JSON.stringify(ours[0])}`);
	const stock = (first?.rows ?? []).filter((row) => !row.ours);
	check(stock.length >= 3, `stock menu items disturbed (saw ${String(stock.length)})`);
	console.log("open #1 (default):", JSON.stringify(first, null, 1));

	// 4 — click → ON, thumb slides right and shows 开.
	await clickToggle();
	const second = await openMenu();
	const onRow = (second?.rows ?? []).find((row) => row.ours);
	check(onRow?.checked === "true", `after click, aria-checked should be true, got ${String(onRow?.checked)}`);
	check(second?.thumbText === "开", `after click, thumb text should be 开, got ${String(second?.thumbText)}`);
	check((second?.thumbLeft ?? 0) >= 14, `thumb should slide right when on (left=${String(second?.thumbLeft)})`);
	console.log("open #2 (after click ON):", JSON.stringify({ checked: onRow?.checked, thumbText: second?.thumbText, thumbLeft: second?.thumbLeft }));

	// 5 — click again → OFF, thumb slides back and shows 关.
	await clickToggle();
	const third = await openMenu();
	const offRow = (third?.rows ?? []).find((row) => row.ours);
	check(offRow?.checked === "false", `after second click, aria-checked should be false, got ${String(offRow?.checked)}`);
	check(third?.thumbText === "关", `after second click, thumb text should be 关, got ${String(third?.thumbText)}`);
	console.log("open #3 (after click OFF):", JSON.stringify({ checked: offRow?.checked, thumbText: third?.thumbText }));

	check(pageErrors.length === 0, `page errors: ${pageErrors.join(" | ")}`);
} finally {
	await browser.close();
}

if (failures.length > 0) {
	console.error("\nFAIL:");
	for (const failure of failures) console.error(" - " + failure);
	process.exit(1);
}
console.log("\nPASS: + menu toggle verified");
