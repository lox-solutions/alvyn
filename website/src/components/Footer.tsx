export function Footer() {
  return (
    <footer className="mt-auto border-t border-fd-border py-6 text-sm text-fd-muted-foreground">
      <div className="container mx-auto flex flex-col items-center justify-between gap-2 px-4 sm:flex-row">
        <p>&copy; {new Date().getFullYear()} LOX Solutions GmbH</p>
        <a
          href="https://www.lox-solutions.eu/legal-notice"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 transition-colors hover:text-fd-foreground"
        >
          Legal Notice
        </a>
      </div>
    </footer>
  );
}
