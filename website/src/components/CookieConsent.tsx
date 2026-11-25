"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CONSENT_DAYS,
  CONSENT_KEY,
  CONSENT_MAX_AGE,
  DAY_MS,
  normalizePagePath,
  readConsent,
  saveConsent,
  stopAnalytics,
  syncAnalyticsPage,
  type CookieConsent,
} from "@/lib/cookie-consent";

const CookieSettingsContext = createContext<(() => void) | null>(null);
const linkStyle = "underline underline-offset-4 hover:text-fd-foreground";
const buttonStyle =
  "min-h-10 rounded-md border border-fd-border px-3 py-2 font-medium hover:bg-fd-accent hover:text-fd-accent-foreground";

export function CookieSettingsButton() {
  const openSettings = useContext(CookieSettingsContext);
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={openSettings ?? undefined}
      className={linkStyle}
    >
      Cookie Settings
    </button>
  );
}

export function CookieConsentProvider({
  children,
  gtmId,
  pages,
}: {
  children: ReactNode;
  gtmId?: string;
  pages: Readonly<Record<string, string>>;
}) {
  const pathname = usePathname();
  // undefined until browser storage has been checked (including during SSR).
  const [consent, setConsent] = useState<CookieConsent | null>();
  const [analytics, setAnalytics] = useState(false);
  const [error, setError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!gtmId) return;
    function refresh() {
      setConsent(readConsent());
    }
    function onStorage(event: StorageEvent) {
      if (event.key === CONSENT_KEY || event.key === null) refresh();
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") refresh();
    }
    refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [gtmId]);

  useEffect(() => {
    if (!consent) return;
    const expiresAt = consent.decidedAt + CONSENT_MAX_AGE;
    let timer: number;
    function checkExpiry() {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) setConsent(readConsent());
      // Bound the native timer delay and recheck after clock changes.
      else timer = window.setTimeout(checkExpiry, Math.min(remaining, DAY_MS));
    }
    checkExpiry();
    return () => window.clearTimeout(timer);
  }, [consent]);

  useEffect(() => {
    if (gtmId && consent?.analytics) syncAnalyticsPage(gtmId, pathname, pages);
  }, [gtmId, consent, pathname, pages]);

  useEffect(() => {
    if (gtmId && consent !== undefined && !consent?.analytics) stopAnalytics();
  }, [gtmId, consent]);

  function openSettings() {
    setAnalytics(!!gtmId && (readConsent()?.analytics ?? false));
    setError(false);
    dialog.current?.showModal();
  }

  function choose(allowAnalytics: boolean) {
    if (!gtmId) return;
    try {
      setConsent(saveConsent(allowAnalytics));
      setError(false);
      dialog.current?.close();
    } catch {
      setError(true);
    }
  }

  const saveError = error && (
    <p role="alert" className="font-medium">
      Your choice wasn&apos;t saved. Please allow site storage in your browser
      and try again.
    </p>
  );

  return (
    <CookieSettingsContext.Provider value={openSettings}>
      {children}
      {gtmId &&
        consent === null &&
        Object.hasOwn(pages, normalizePagePath(pathname)) && (
          <section
            aria-labelledby="cookie-banner-title"
            className="fixed inset-x-3 bottom-3 z-40 flex max-h-[calc(100dvh-1.5rem)] flex-col gap-3 overflow-auto rounded-xl border border-fd-border bg-fd-popover p-4 text-sm text-fd-popover-foreground shadow-lg sm:left-auto sm:w-lg"
          >
            <h2 id="cookie-banner-title" className="text-base font-semibold">
              Your privacy choices
            </h2>
            <p className="text-fd-muted-foreground">
              If you agree, we use Google Tag Manager and Google Analytics to
              measure visits to Alvyn and its documentation. Analytics is off by
              default. You can change your choice at any time in Cookie
              Settings.{" "}
              <a href="/privacy" className={linkStyle}>
                Privacy &amp; Cookies
              </a>
            </p>
            {saveError}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonStyle}
                onClick={() => choose(false)}
              >
                Necessary only
              </button>
              <button
                type="button"
                className={buttonStyle}
                onClick={() => choose(true)}
              >
                Accept analytics
              </button>
              <button
                type="button"
                className={buttonStyle}
                aria-haspopup="dialog"
                onClick={openSettings}
              >
                Customize
              </button>
            </div>
          </section>
        )}
      <dialog
        ref={dialog}
        aria-labelledby="cookie-settings-title"
        aria-describedby="cookie-settings-description"
        onClose={() => setError(false)}
        className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-lg overflow-auto rounded-xl border border-fd-border bg-fd-popover p-5 text-sm text-fd-popover-foreground shadow-lg backdrop:bg-black/50"
      >
        <h2 id="cookie-settings-title" className="text-xl font-semibold">
          Cookie Settings
        </h2>
        <p
          id="cookie-settings-description"
          className="mt-2 text-fd-muted-foreground"
        >
          Analytics is optional. You can use the site without it and withdraw
          consent here at any time.
        </p>
        <div className="mt-4 space-y-3">
          <section className="rounded-lg border border-fd-border p-3">
            <h3 className="font-semibold">Necessary · Always active</h3>
            <p className="mt-1 text-fd-muted-foreground">
              We store your display preferences locally. Your cookie choice is
              valid in this browser for {CONSENT_DAYS} days.
            </p>
          </section>
          <section className="rounded-lg border border-fd-border p-3">
            <label className="flex items-center gap-2 font-semibold">
              <input
                type="checkbox"
                checked={analytics}
                disabled={!gtmId}
                onChange={(event) => setAnalytics(event.target.checked)}
                className="size-4 accent-fd-primary"
              />
              Analytics · Google Tag Manager / Google Analytics
            </label>
            <p className="mt-1 text-fd-muted-foreground">
              {gtmId
                ? "If enabled, Google Analytics measures visits and can set cookies to recognize your browser. We do not enable advertising or ad personalization."
                : "Optional analytics is currently disabled on this site."}
            </p>
          </section>
          <p className="text-fd-muted-foreground">
            See{" "}
            <a href="/privacy" className={linkStyle}>
              Privacy &amp; Cookies
            </a>{" "}
            for details.
          </p>
          {saveError}
          <div className="grid gap-2 sm:grid-cols-2">
            {gtmId && (
              <>
                <button
                  type="button"
                  className={buttonStyle}
                  onClick={() => choose(false)}
                >
                  Necessary only
                </button>
                <button
                  type="button"
                  className={buttonStyle}
                  onClick={() => choose(true)}
                >
                  Accept analytics
                </button>
                <button
                  type="button"
                  className={buttonStyle}
                  onClick={() => choose(analytics)}
                >
                  Save selection
                </button>
              </>
            )}
            <button
              type="button"
              className={buttonStyle}
              onClick={() => dialog.current?.close()}
            >
              Close without changes
            </button>
          </div>
        </div>
      </dialog>
    </CookieSettingsContext.Provider>
  );
}
