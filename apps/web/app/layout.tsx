import type { Metadata } from "next";
import { Geist, Geist_Mono, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { AlertBadge } from "@/components/alerts/alert-badge";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aequitas FI",
  description: "Hybrid SQL + RAG financial intelligence dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${jetbrainsMono.variable} min-h-screen bg-background font-sans text-foreground selection:bg-primary/20 selection:text-foreground`}
      >
        <Providers>
          <div className="flex min-h-screen flex-col bg-background">
            <header className="glass-terminal sticky top-0 z-40 border-x-0 border-t-0 border-b border-border bg-background/90 px-4 py-3">
              <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between">
                <div className="flex items-center gap-4">
                  <Link
                    href="/"
                    className="font-mono text-xs uppercase tracking-[0.18em] text-foreground"
                  >
                    Aequitas FI
                  </Link>
                  <nav className="flex items-center gap-2">
                    <Link
                      href="/"
                      className="rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground transition hover:border-ring hover:text-foreground"
                    >
                      Dashboard
                    </Link>
                    <Link
                      href="/research"
                      className="rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground transition hover:border-ring hover:text-foreground"
                    >
                      Research
                    </Link>
                    <Link
                      href="/alerts"
                      className="rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground transition hover:border-ring hover:text-foreground"
                    >
                      Alerts
                    </Link>
                    <Link
                      href="/debate"
                      className="rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground transition hover:border-ring hover:text-foreground"
                    >
                      Debate
                    </Link>
                    <Link
                      href="/portfolio"
                      className="rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground transition hover:border-ring hover:text-foreground"
                    >
                      Portfolio
                    </Link>
                  </nav>
                </div>
                <div className="flex items-center gap-2">
                  <ThemeToggle />
                  <AlertBadge />
                </div>
              </div>
            </header>
            <main className="min-h-0 flex-1">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
