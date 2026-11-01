import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "KudoBird", description: "Certificates of contribution for any cause" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">{children}</body>
    </html>
  );
}
