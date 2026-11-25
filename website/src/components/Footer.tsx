import { CookieSettingsButton } from "@/components/CookieConsent";

const linkStyle =
  "underline underline-offset-4 transition-colors hover:text-fd-foreground";

export function FooterLinks() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <a
        href="https://www.lox-solutions.eu/legal-notice"
        target="_blank"
        rel="noopener noreferrer"
        className={linkStyle}
      >
        Legal Notice
      </a>
      {/* Use document navigation so previously loaded tags do not follow. */}
      <a href="/privacy" className={linkStyle}>
        Privacy &amp; Cookies
      </a>
      <CookieSettingsButton />
    </div>
  );
}

export function Footer() {
  return (
    <footer className="mt-auto border-t border-fd-border py-6 text-sm text-fd-muted-foreground">
      <div className="container mx-auto flex flex-col items-center justify-between gap-2 px-4 sm:flex-row">
        <p>&copy; {new Date().getFullYear()} LOX Solutions GmbH</p>
        <FooterLinks />
      </div>
    </footer>
  );
}
