import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

const themeScript = `
try {
  if (localStorage.getItem("outbound-theme") === "dark" ||
      (!localStorage.getItem("outbound-theme") && matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.documentElement.classList.add("dark");
  }
} catch {}
`;

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  const title = "CBT Outbound Operations Hub";
  const description =
    "Pantau SO, kapasitas picker, Wave dan Drop dinamis, assignment manual, serta Bulk Upload WMS dalam satu ruang kerja.";
  return {
    metadataBase,
    title: { default: title, template: "%s / CBT Outbound Assignment Hub" },
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>{children}</body>
    </html>
  );
}
