import Link from "next/link";
import {
  ArrowLeft,
  KeyRound,
  ScrollText,
  ServerCog,
  ShieldAlert,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const CAPABILITY_AREAS = [
  {
    icon: KeyRound,
    title: "Access governance",
    body: "Reviewing roles, permissions, and administrator assignments is not available in this build. No user or role data is exposed here.",
  },
  {
    icon: ScrollText,
    title: "Audit trails",
    body: "Browsing audit events, activity history, or security incidents is not available in this build. No audit log is exposed here.",
  },
  {
    icon: ServerCog,
    title: "System telemetry",
    body: "Inspecting service health, resource usage, or pipeline metrics is not available in this build. No telemetry is collected or shown here.",
  },
] as const;

export default function AdminPage() {
  return (
    <div className="mx-auto w-full max-w-5xl overflow-x-clip px-4 py-6">
      <div className="mb-4">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Dashboard
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-sans text-lg font-semibold tracking-tight text-foreground">
            Administration
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Administrative controls for access, audit history, and system
            telemetry, once a supported administration contract exists.
          </p>
        </div>
        <Badge variant="default" aria-live="polite">
          <ShieldAlert className="h-3 w-3" aria-hidden />
          Not provisioned
        </Badge>
      </div>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-foreground">
          Administration is not provisioned in this build
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
          This workspace describes where administrative capabilities will live,
          but none of them are connected or operable yet. Nothing on this page
          manages users, changes permissions, inspects audit history, or
          monitors system health. Presenting these areas below as unavailable —
          rather than as working controls — keeps that boundary explicit.
        </p>
      </Card>

      <section
        aria-label="Administrative capability areas"
        className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {CAPABILITY_AREAS.map((area) => (
          <Card key={area.title} className="p-4">
            <div className="flex items-center gap-2">
              <area.icon
                className="h-4 w-4 text-muted-foreground"
                aria-hidden
              />
              <h2 className="text-sm font-semibold text-foreground">
                {area.title}
              </h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {area.body}
            </p>
            <p className="mt-3">
              <Badge variant="default">Unavailable</Badge>
            </p>
          </Card>
        ))}
      </section>

      <p className="mt-4 text-xs text-muted-foreground">
        Enabling any of these areas requires a real administrative data source,
        an explicit action contract, and authorization rules — none of which
        are part of the current build.
      </p>
    </div>
  );
}
