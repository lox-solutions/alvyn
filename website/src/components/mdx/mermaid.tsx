import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { renderMermaidSVG } from "beautiful-mermaid";
import DOMPurify from "isomorphic-dompurify";

export async function Mermaid({ chart }: { chart: string }) {
  let svg: string;
  try {
    svg = renderMermaidSVG(chart, {
      bg: "var(--color-fd-background)",
      fg: "var(--color-fd-foreground)",
      interactive: true,
      transparent: true,
    });
  } catch {
    return (
      <CodeBlock title="Mermaid">
        <Pre>{chart}</Pre>
      </CodeBlock>
    );
  }
  const cleanSvg = DOMPurify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });

  return (
    <div
      className="overflow-x-auto max-w-full my-4"
      dangerouslySetInnerHTML={{ __html: cleanSvg }}
    />
  );
}
