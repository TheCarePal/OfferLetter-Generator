import type { Metadata } from "next";
import { getPublicAssetPath } from "@/lib/public-path";
import "./globals.css";

export const metadata: Metadata = {
  title: "CarePal Offer Letter Creator",
  description:
    "Create and download employee offer letters for Carepalz Internet Private Limited.",
  icons: { icon: getPublicAssetPath("/carepal-logo.png") },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
