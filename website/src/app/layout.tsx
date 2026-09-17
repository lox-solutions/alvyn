import { Provider } from "@/components/provider";
import "./global.css";
import { Inter } from "next/font/google";
import type { Metadata } from "next";
import { baseUrl } from "@/lib/shared";

const inter = Inter({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NODE_ENV === "development"
      ? `http://localhost:${process.env.PORT ?? 3000}/`
      : `${baseUrl}/`,
  ),
  title: {
    default: "Alvyn | Event history for TypeScript and AI agents",
    template: "%s | Alvyn",
  },
  description:
    "Store agent tool calls and business events in PostgreSQL. Rebuild application state with typed events, projections, an outbox, and optional envelope encryption.",
  openGraph: {
    title: "Alvyn | Event history for TypeScript and AI agents",
    description:
      "Keep the steps, not just the result. PostgreSQL-native event history for AI agents, orders, and everyday TypeScript applications.",
    url: "/",
    siteName: "Alvyn",
    locale: "en",
    type: "website",
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Alvyn | Event history for TypeScript and AI agents",
    description:
      "Keep the steps, not just the result. PostgreSQL-native event history for AI agents, orders, and everyday TypeScript applications.",
    images: ["/opengraph-image"],
  },
  icons: {
    icon: "/icon",
  },
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
