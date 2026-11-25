import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONSENT_KEY,
  CONSENT_MAX_AGE,
  CONSENT_VERSION,
  isTagManagerId,
  parseConsent,
  readConsent,
  saveConsent,
  stopAnalytics,
  syncAnalyticsPage,
} from "../src/lib/cookie-consent";

const gtm = "GTM-ALVYNTEST";
const pages = {
  "/docs": "Introduction",
  "/docs/outbox": "Transactional Outbox",
};

function mockBrowser() {
  const storage = new Map<string, string>();
  const scripts: HTMLScriptElement[] = [];
  const deleted: string[] = [];
  let reloads = 0;
  globalThis.window = {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    location: {
      hostname: "www.alvyn.test",
      origin: "https://www.alvyn.test",
      href: "https://www.alvyn.test/docs?secret=value#section",
      reload: () => reloads++,
    },
  } as unknown as Window & typeof globalThis;
  globalThis.document = {
    createElement: () => ({ dataset: {} }),
    getElementById: (id: string) => scripts.find((script) => script.id === id),
    head: { appendChild: (script: HTMLScriptElement) => scripts.push(script) },
    get cookie() {
      return "_ga=one; _ga_ABCD=two; _gid=three; other=four";
    },
    set cookie(value: string) {
      deleted.push(value);
    },
  } as unknown as Document;
  return { storage, scripts, deleted, reloads: () => reloads };
}

function commands() {
  return (window.dataLayer ?? []).map((item) =>
    Object.prototype.toString.call(item) === "[object Arguments]"
      ? Array.from(item as IArguments)
      : item,
  );
}

const denied = {
  analytics_storage: "denied",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
};

test("both choices expire and invalid or incompatible records fail closed", () => {
  const now = CONSENT_MAX_AGE * 2;
  const choice = { version: CONSENT_VERSION, analytics: true, decidedAt: now };
  for (const analytics of [true, false]) {
    const saved = { ...choice, analytics };
    assert.deepEqual(
      parseConsent(JSON.stringify(saved), now + CONSENT_MAX_AGE - 1),
      saved,
    );
    assert.equal(
      parseConsent(JSON.stringify(saved), now + CONSENT_MAX_AGE),
      null,
    );
  }
  for (const invalid of [
    null,
    "nonsense",
    JSON.stringify({ ...choice, version: CONSENT_VERSION + 1 }),
    JSON.stringify({ ...choice, analytics: "true" }),
    JSON.stringify({ ...choice, decidedAt: now + 1 }),
  ]) {
    assert.equal(parseConsent(invalid, now), null);
  }
  assert.ok(isTagManagerId(gtm));
  assert.ok(!isTagManagerId("G-ABC"));
  assert.ok(!isTagManagerId("GTM-ABC&other=1"));
});

test("GTM does not start without valid opt-in, on unknown pages, or for invalid IDs", () => {
  const { scripts, storage } = mockBrowser();
  syncAnalyticsPage(gtm, "/docs", pages);
  saveConsent(false);
  syncAnalyticsPage(gtm, "/docs", pages);
  storage.set(
    CONSENT_KEY,
    JSON.stringify({ ...saveConsent(true), decidedAt: 0 }),
  );
  syncAnalyticsPage(gtm, "/docs", pages);
  assert.equal(readConsent(), null);
  saveConsent(true);
  syncAnalyticsPage(gtm, "/privacy", pages);
  syncAnalyticsPage(gtm, "/docs/unknown", pages);
  syncAnalyticsPage(gtm, "/constructor", pages);
  syncAnalyticsPage("G-123", "/docs", pages);
  assert.equal(scripts.length, 0);
  assert.equal(window.dataLayer, undefined);
});

test("inaccessible storage fails closed and does not report a saved choice", () => {
  const { scripts } = mockBrowser();
  Object.defineProperty(window, "localStorage", {
    get() {
      throw new Error("Storage blocked");
    },
  });
  assert.throws(() => saveConsent(true), /Storage blocked/);
  assert.equal(readConsent(), null);
  syncAnalyticsPage(gtm, "/docs", pages);
  assert.equal(scripts.length, 0);
});

test("initialization queues consent and safe context once; later routes send one pageview", () => {
  const { scripts } = mockBrowser();
  saveConsent(true);
  syncAnalyticsPage(gtm, "/docs", pages);
  syncAnalyticsPage(gtm, "/docs/", pages);

  assert.equal(scripts.length, 1);
  assert.equal(
    scripts[0].src,
    `https://www.googletagmanager.com/gtm.js?id=${gtm}`,
  );
  assert.equal(scripts[0].referrerPolicy, "no-referrer");
  assert.deepEqual(commands().slice(0, 3), [
    ["consent", "default", denied],
    ["consent", "update", { ...denied, analytics_storage: "granted" }],
    [
      "set",
      {
        page_location: "https://www.alvyn.test/docs",
        page_title: "Introduction",
        page_referrer: "",
        allow_google_signals: false,
      },
    ],
  ]);
  assert.equal((commands()[3] as { event: string }).event, "gtm.js");
  assert.equal(commands().length, 4);

  syncAnalyticsPage(gtm, "/docs/outbox", pages);
  syncAnalyticsPage(gtm, "/docs/outbox", pages);
  const nextPage = {
    page_location: "https://www.alvyn.test/docs/outbox",
    page_title: "Transactional Outbox",
    page_referrer: "",
  };
  assert.deepEqual(commands().slice(4), [
    ["set", nextPage],
    ["event", "page_view", nextPage],
  ]);
});

test("withdrawal denies consent, deletes only GA cookies, and discards the active document", () => {
  const browser = mockBrowser();
  saveConsent(true);
  syncAnalyticsPage(gtm, "/docs", pages);
  saveConsent(false);
  stopAnalytics();
  assert.deepEqual(commands().at(-1), ["consent", "update", denied]);
  assert.equal(readConsent()?.analytics, false);
  assert.equal(browser.reloads(), 1);
  assert.deepEqual(
    new Set(browser.deleted.map((cookie) => cookie.split("=")[0])),
    new Set(["_ga", "_ga_ABCD", "_gid"]),
  );
  assert.ok(
    browser.deleted.includes(
      "_ga=; Max-Age=0; Path=/; Domain=alvyn.test; SameSite=Lax",
    ),
  );
  assert.ok(!browser.deleted.some((cookie) => cookie.startsWith("other=")));
});
