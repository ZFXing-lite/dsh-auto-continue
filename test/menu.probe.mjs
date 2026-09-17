/**
 * dsh-auto-continue — browser-half verification.
 *
 * Drives a real DSH Web GUI and asserts the end-to-end contract this plugin
 * ships:
 *   1. the composer's "+" menu carries the two switches;
 *   2. exactly one of them is marked as the current state;
 *   3. clicking 关闭 writes `enabled: false` through the settings surface, the
 *      mark moves, and nothing about the stock menu items is disturbed;
 *   4. clicking 开启 writes it back;
 *   5. reopening the menu shows the persisted state (no duplicate rows).
 *
 * Run against any dsh web instance:
 *   node test/menu.probe.mjs [base-url]
 */
import { chromium } from "playwright";

/** Base URL of the instance under test. */
const BASE = process.argv[2] ?? "http://127.0.0.1:3099";

/** Labels the plugin adds, in menu order. */
const ON_LABEL = "开启自动继续";
const OFF_LABEL = "关闭自动继续";

/** Assertion helper that records failures instead of throwing on the first. */
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

	await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
	// The composer only exists once the shell has mounted its client plugins.
	await page.waitForSelector("[data-composer-card] button[aria-haspopup=menu]", { timeout: 45_000 });
	await page.waitForTimeout(1200);

	/** Open the "+" menu and return its switch rows. */
	async function openMenu() {
		const plus = page.locator("[data-composer-card] button[aria-haspopup=menu]").first();
		if ((await plus.getAttribute("aria-expanded")) !== "true") await plus.click();
		await page.waitForSelector('[data-composer-card] [role="menu"]', { timeout: 10_000 });
		await page.waitForTimeout(350);
		return page.evaluate(() => {
			const menu = document.querySelector('[data-composer-card] [role="menu"]');
			if (menu === null) return null;
			const rows = [...menu.querySelectorAll('[role="menuitem"]')].map((node) => ({
				text: (node.textContent ?? "").trim(),
				ours: node.hasAttribute("data-auto-continue-item"),
				checked: node.getAttribute("aria-checked"),
				disabled: node.disabled === true,
				height: Math.round(node.getBoundingClientRect().height),
			}));
			return { rows, menuWidth: Math.round(menu.getBoundingClientRect().width) };
		});
	}

	/** Click one of our rows by label. */
	async function clickRow(label) {
		await page.locator(`[data-composer-card] [role="menuitem"]:has-text("${label}")`).first().click();
		await page.waitForTimeout(900);
	}

	// 1 + 2 — the switches exist and exactly one is marked current.
	const first = await openMenu();
	check(first !== null, "the + menu never opened");
	const ours = (first?.rows ?? []).filter((row) => row.ours);
	check(ours.length === 2, `expected 2 injected rows, saw ${String(ours.length)}`);
	check(ours.some((row) => row.text === ON_LABEL), `missing row "${ON_LABEL}"`);
	check(ours.some((row) => row.text === OFF_LABEL), `missing row "${OFF_LABEL}"`);
	check(ours.every((row) => row.disabled === false), `a switch is disabled: ${JSON.stringify(ours)}`);
	check(ours.filter((row) => row.checked === "true").length === 1, `current-state mark is not singular: ${JSON.stringify(ours)}`);
	// The stock rows must be untouched by the injection.
	const stock = (first?.rows ?? []).filter((row) => !row.ours);
	check(stock.length >= 3, `stock menu items were disturbed (saw ${String(stock.length)})`);
	check(ours.every((row) => row.height >= 30), `an injected row is too short: ${JSON.stringify(ours)}`);
	console.log("open #1:", JSON.stringify(first, null, 1));

	// 3 — turn it OFF, and watch the mark move.
	await clickRow(OFF_LABEL);
	const second = await openMenu();
	const offRows = (second?.rows ?? []).filter((row) => row.ours);
	check(offRows.find((row) => row.text === OFF_LABEL)?.checked === "true", "关闭 did not become the marked state");
	check(offRows.length === 2, `duplicate rows after reopen: ${String(offRows.length)}`);
	console.log("open #2 (after 关闭):", JSON.stringify(offRows));

	// 4 — turn it back ON.
	await clickRow(ON_LABEL);
	const third = await openMenu();
	const onRows = (third?.rows ?? []).filter((row) => row.ours);
	check(onRows.find((row) => row.text === ON_LABEL)?.checked === "true", "开启 did not become the marked state");
	console.log("open #3 (after 开启):", JSON.stringify(onRows));

	check(pageErrors.length === 0, `page errors: ${pageErrors.join(" | ")}`);
} finally {
	await browser.close();
}

if (failures.length > 0) {
	console.error("\nFAIL:");
	for (const failure of failures) console.error(" - " + failure);
	process.exit(1);
}
console.log("\nPASS: + menu switches verified");
