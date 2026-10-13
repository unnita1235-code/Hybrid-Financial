import type { Metadata } from "next";
import { Geist, Inter, JetBrains_Mono, Sora } from "next/font/google";
import Link from "next/link";
import { AlertBadge } from "@/components/alerts/alert-badge";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Providers } from "./providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const soraSans = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const interMono = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
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
        className={`${geistSans.variable} ${soraSans.variable} ${interMono.variable} ${jetbrainsMono.variable} min-h-screen bg-background font-sans text-foreground selection:bg-primary/20 selection:text-foreground`}
      >
        <Providers>
          <div className="flex min-h-screen flex-col bg-background">
            <header className="glass-terminal sticky top-0 z-40 border-x-0 border-t-0 border-b border-border/50 bg-background/95 px-4 py-3">
              <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-6">
                  <Link
                    href="/"
                    className="shrink-0 font-sans text-sm font-bold uppercase tracking-[0.12em] text-foreground"
                  >
                    Aequitas FI
                  </Link>
                  <nav aria-label="Primary" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [&>a]:shrink-0">
                    <Link
                      href="/"
                      className="rounded-lg border border-border/40 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground hover:bg-primary/5"
                    >
                      Dashboard
                    </Link>
                    <Link
                      href="/research"
                      className="rounded-lg border border-border/40 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground hover:bg-primary/5"
                    >
                      Research
                    </Link>
                    <Link
                      href="/alerts"
                      className="rounded-lg border border-border/40 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground hover:bg-primary/5"
                    >
                      Alerts
                    </Link>
                    <Link
                      href="/debate"
                      className="rounded-lg border border-border/40 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground hover:bg-primary/5"
                    >
                      Debate
                    </Link>
                    <Link
                      href="/portfolio"
                      className="rounded-lg border border-border/40 px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground hover:bg-primary/5"
                    >
                      Portfolio
                    </Link>
                  </nav>
                </div>
                <div className="flex shrink-0 items-center gap-2">
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
