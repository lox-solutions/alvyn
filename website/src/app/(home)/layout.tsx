import { Footer } from "@/components/Footer";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { baseOptions } from "@/lib/layout.shared";

export default function Layout({ children }: LayoutProps<"/">) {
  const base = baseOptions();
  return (
    <HomeLayout
      {...base}
      links={[
        {
          text: "Docs",
          url: "/docs",
          secondary: true,
        },
        {
          text: "llms.txt",
          url: "/llms.txt",
          secondary: true,
          external: true,
        },
        {
          text: "llms-full.txt",
          url: "/llms-full.txt",
          secondary: true,
          external: true,
        },
      ]}
    >
      {children}
      <Footer />
    </HomeLayout>
  );
}
