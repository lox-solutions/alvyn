import { source } from "@/lib/source";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { baseOptions } from "@/lib/layout.shared";

function SidebarFooter() {
  return (
    <div className="flex flex-col mt-4 gap-1 text-xs text-fd-muted-foreground">
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
  );
}

export default function Layout({ children }: LayoutProps<"/docs">) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      {...baseOptions()}
      sidebar={{ footer: <SidebarFooter /> }}
    >
      {children}
    </DocsLayout>
  );
}
