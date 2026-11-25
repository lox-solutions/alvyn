export const CONSENT_KEY = "alvyn.cookie-consent";
// Increase this when the disclosed providers or purposes change.
export const CONSENT_VERSION = 1;
export const CONSENT_DAYS = 180;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const CONSENT_MAX_AGE = CONSENT_DAYS * DAY_MS;

export type CookieConsent = {
  version: typeof CONSENT_VERSION;
  analytics: boolean;
  decidedAt: number;
};

export function parseConsent(
  raw: string | null,
  now = Date.now(),
): CookieConsent | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (
      value?.version === CONSENT_VERSION &&
      typeof value.analytics === "boolean" &&
      Number.isSafeInteger(value.decidedAt) &&
      value.decidedAt >= 0 &&
      value.decidedAt <= now &&
      now - value.decidedAt < CONSENT_MAX_AGE
    ) {
      return {
        version: CONSENT_VERSION,
        analytics: value.analytics,
        decidedAt: value.decidedAt,
      };
    }
  } catch {
    // Ignore malformed records and ask for a fresh choice.
  }
  return null;
}

export function readConsent() {
  try {
    return parseConsent(window.localStorage.getItem(CONSENT_KEY));
  } catch {
    return null;
  }
}

export function saveConsent(analytics: boolean): CookieConsent {
  const consent = {
    version: CONSENT_VERSION,
    analytics,
    decidedAt: Date.now(),
  } as const;
  window.localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
  return consent;
}

export function isTagManagerId(value: string | undefined): value is string {
  return !!value && /^GTM-[A-Z0-9]+$/.test(value);
}

const GTM_SCRIPT_ID = "alvyn-gtm";
const DENIED = {
  analytics_storage: "denied",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
} as const;
const GA_COOKIE = /^(_ga(?:_.*)?|_gid|_gat(?:_.*)?)$/;

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

function googleCommand(..._args: unknown[]) {
  // The on-page GTM integration expects Arguments, not an array.
  window.dataLayer?.push(arguments);
}

function getContainer() {
  return document.getElementById(GTM_SCRIPT_ID);
}

export function normalizePagePath(pathname: string) {
  return pathname.replace(/\/$/, "") || "/";
}

export function syncAnalyticsPage(
  gtmId: string,
  pathname: string,
  pages: Readonly<Record<string, string>>,
) {
  const path = normalizePagePath(pathname);
  const container = getContainer();
  if (!Object.hasOwn(pages, path)) {
    // Privacy links already use document navigation. Also discard loaded tags
    // if another client-side link ever leads outside the tracked pages.
    if (container) window.location.reload();
    return;
  }
  if (!isTagManagerId(gtmId) || !readConsent()?.analytics) return;
  if (container?.dataset.page === path) return;

  const page = {
    page_location: window.location.origin + path,
    page_title: pages[path],
    page_referrer: "",
  };
  if (container) {
    container.dataset.page = path;
    googleCommand("set", page);
    // The Google tag sends the first page_view. Only send later SPA views here.
    googleCommand("event", "page_view", page);
    return;
  }

  const layer = (window.dataLayer ??= []);
  googleCommand("consent", "default", DENIED);
  googleCommand("consent", "update", {
    ...DENIED,
    analytics_storage: "granted",
  });
  googleCommand("set", { ...page, allow_google_signals: false });
  layer.push({ "gtm.start": Date.now(), event: "gtm.js" });

  const script = document.createElement("script");
  script.id = GTM_SCRIPT_ID;
  script.dataset.page = path;
  script.async = true;
  script.referrerPolicy = "no-referrer";
  script.src = `https://www.googletagmanager.com/gtm.js?id=${gtmId}`;
  document.head.appendChild(script);
}

export function stopAnalytics() {
  const container = getContainer();
  if (container) googleCommand("consent", "update", DENIED);

  // GA can use a host-only or parent-domain cookie. Leave unrelated cookies alone.
  const labels = window.location.hostname.split(".");
  const domains = [
    "",
    ...labels.map((_, i) => `; Domain=${labels.slice(i).join(".")}`),
  ];
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0].trim();
    if (!GA_COOKIE.test(name)) continue;
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; Path=/${domain}; SameSite=Lax`;
    }
  }
  // Removing a script node would not remove its listeners or timers.
  if (container) window.location.reload();
}
