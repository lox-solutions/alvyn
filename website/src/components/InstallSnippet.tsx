"use client";

import { useCopyButton } from "fumadocs-ui/utils/use-copy-button";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";

async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fallback for restricted clipboard contexts
    }
  }

  if (typeof document !== "undefined") {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
      document.execCommand("copy");
    } finally {
      textArea.remove();
    }
  }
}

export function InstallSnippet({
  command = "npm install alvyn pg",
}: {
  command?: string;
}) {
  const [checked, onClick] = useCopyButton(() => {
    return copyToClipboard(command);
  });

  return (
    <div className="inline-flex items-center justify-between gap-3 rounded-xl border border-fd-border bg-fd-secondary/70 backdrop-blur-sm pl-4 pr-2 py-2 max-w-full shadow-xs text-sm transition-colors hover:border-fd-primary/30">
      <code className="font-mono text-xs sm:text-sm text-fd-foreground select-all">
        {command}
      </code>
      <button
        type="button"
        onClick={onClick}
        aria-label={checked ? "Copied command" : "Copy install command"}
        title={checked ? "Copied!" : "Copy to clipboard"}
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon-xs" }),
          "h-7 w-7 rounded-lg text-fd-muted-foreground hover:text-fd-foreground hover:bg-fd-accent transition-all cursor-pointer",
          checked && "text-emerald-500 hover:text-emerald-500",
        )}
      >
        {checked ? (
          <Check className="size-3.5 transition-transform scale-110 stroke-[2.5]" />
        ) : (
          <Copy className="size-3.5" />
        )}
      </button>
    </div>
  );
}
