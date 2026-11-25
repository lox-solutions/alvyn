import { CookieConsentProvider } from "@/components/CookieConsent";
import { Provider } from "@/components/provider";
import "./global.css";
import { Inter } from "next/font/google";
import type { Metadata } from "next";
import { isTagManagerId } from "@/lib/cookie-consent";
import { baseUrl } from "@/lib/shared";
import { source } from "@/lib/source";

const homeTitle = "Alvyn | Event history for TypeScript and AI agents";

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
    default: homeTitle,
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
  const id = process.env.NEXT_PUBLIC_GTM_ID;
  const gtmId = isTagManagerId(id) ? id : undefined;
  const trackedPages = gtmId
    ? Object.fromEntries([
        ["/", homeTitle],
        ...source.getPages().map((page) => [page.url, page.data.title]),
      ])
    : {};

  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>
          <CookieConsentProvider gtmId={gtmId} pages={trackedPages}>
            {children}
          </CookieConsentProvider>
        </Provider>
      </body>
    </html>
  );
}
