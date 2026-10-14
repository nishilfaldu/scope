import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { ConvexClientProvider } from "./ConvexClientProvider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/toast";
import { siteDescription, siteTitle, siteUrl } from "@/lib/site";
import { cn } from "@/lib/utils";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: siteTitle, template: "%s · Scope" },
  description: siteDescription,
  applicationName: "Scope",
  keywords: [
    "MCP server",
    "Model Context Protocol",
    "AI agent permissions",
    "AI tool approvals",
    "Cursor MCP",
    "Claude connector",
    "ChatGPT connector",
  ],
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    siteName: "Scope",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "h-full antialiased font-sans",
        geistSans.variable,
        geistMono.variable,
        inter.variable,
      )}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          forcedTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <Toaster>
            <ConvexClientProvider>{children}</ConvexClientProvider>
          </Toaster>
        </ThemeProvider>
      </body>
    </html>
  );
}
