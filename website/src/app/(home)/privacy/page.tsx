import { CookieSettingsButton } from "@/components/CookieConsent";
import { CONSENT_DAYS } from "@/lib/cookie-consent";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy & Cookies",
  description: "How Alvyn uses browser storage and optional analytics.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <article className="container mx-auto max-w-3xl space-y-8 px-4 py-16 text-fd-muted-foreground">
      <header className="space-y-3">
        <h1 className="text-3xl font-bold text-fd-foreground">
          Privacy &amp; Cookies
        </h1>
        <p>
          This information applies to the Alvyn website and documentation at
          alvyn.dev. The website is operated by LOX Solutions GmbH. Contact
          details are listed in the{" "}
          <a
            href="https://www.lox-solutions.eu/legal-notice"
            className="underline"
          >
            Legal Notice
          </a>
          .
        </p>
      </header>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-fd-foreground">
          Necessary browser storage
        </h2>
        <p>
          We use browser storage to remember your display preferences and cookie
          choice. We honor your cookie choice for up to {CONSENT_DAYS} days in
          this browser. You can use the entire site without analytics.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-fd-foreground">
          Optional analytics
        </h2>
        <p>
          If analytics is available and you consent, we load Google Tag Manager
          to run Google Analytics 4 on the Alvyn homepage and documentation. We
          use it to understand which pages are visited. Analytics can use
          cookies such as <code>_ga</code> and <code>_ga_*</code> to recognize
          browsers and sessions. Google receives technical and usage data,
          including connection and page view information. Processing can take
          place outside the EEA, including in the US. We do not enable
          advertising or ad personalization.
        </p>
        <p>
          See{" "}
          <a
            href="https://policies.google.com/technologies/partner-sites"
            className="underline"
          >
            how Google uses information from websites and apps
          </a>{" "}
          for more information.
        </p>
      </section>
      <section className="space-y-2">
        <h2 className="text-xl font-semibold text-fd-foreground">
          Change or withdraw your choice
        </h2>
        <p>
          Open <CookieSettingsButton /> and choose “Necessary only” to turn off
          future analytics. This does not delete data already collected.
        </p>
      </section>
    </article>
  );
}
