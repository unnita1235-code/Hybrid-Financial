import type { Metadata } from "next";
import { Sora, Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import { AlertBadge } from "@/components/alerts/alert-badge";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Providers } from "./providers";
import "./globals.css";

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
        className={`${soraSans.variable} ${interMono.variable} ${jetbrainsMono.variable} min-h-screen bg-background font-sans text-foreground selection:bg-primary/20 selection:text-foreground`}
      >
        <Providers>
          <div className="flex min-h-screen flex-col bg-background">
            <header className="glass-terminal sticky top-0 z-40 border-x-0 border-t-0 border-b border-border/50 bg-background/95 px-4 py-3">
              <div className="mx-auto flex w-full max-w-[1400px] items-center justify-between">
                <div className="flex items-center gap-6">
                  <Link
                    href="/"
                    className="font-sans text-sm font-bold uppercase tracking-[0.12em] text-foreground"
                  >
                    Aequitas FI
                  </Link>
                  <nav className="flex items-center gap-1">
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
