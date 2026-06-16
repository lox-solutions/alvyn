import { Provider } from "@/components/provider";
import "./global.css";
import { Inter } from "next/font/google";
import type { Metadata } from "next";
import { basePath, baseUrl } from "@/lib/shared";

const inter = Inter({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NODE_ENV === "development"
      ? `http://localhost:${process.env.PORT ?? 3000}${basePath}/`
      : `${baseUrl}${basePath}/`,
  ),
  title: {
    default: "Alvyn | Event Sourcing for TypeScript",
    template: "%s | Alvyn",
  },
  description:
    "A high-fidelity event sourcing framework for TypeScript. Capture every business intent as an immutable, append-only fact to build your Private AI Data Moat.",
  openGraph: {
    title: "Alvyn | Event Sourcing for TypeScript",
    description:
      "Capture every business intent as an immutable, append-only fact. Type-safe event sourcing for TypeScript.",
    url: "/",
    siteName: "Alvyn",
    locale: "en",
    type: "website",
    images: [{ url: "/opengraph-image", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Alvyn | Event Sourcing for TypeScript",
    description:
      "Capture every business intent as an immutable, append-only fact. Type-safe event sourcing for TypeScript.",
    images: ["/opengraph-image"],
  },
  icons: {
    icon: `${basePath}/icon`,
  },
};

export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Provider>
          {children}
        </Provider>
      </body>
    </html>
  );
}
