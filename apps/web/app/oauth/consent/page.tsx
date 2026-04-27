import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

type Props = {
  searchParams: Promise<{ authorization_id?: string }>;
};

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-slate-50">
      <div className="glass-terminal w-full max-w-md rounded-lg border p-6">
        <h1 className="text-lg font-semibold tracking-tight text-slate-100">{title}</h1>
        <div className="mt-4 text-sm text-slate-400">{children}</div>
      </div>
    </div>
  );
}

export default async function OAuthConsentPage({ searchParams }: Props) {
  const { authorization_id: authorizationId } = await searchParams;

  if (!isSupabaseConfigured()) {
    return (
      <Shell title="Configuration required">
        <p>
          Set <code className="text-cyan-400/90">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="text-cyan-400/90">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>{" "}
          in <code className="text-cyan-400/90">.env.local</code>.
        </p>
      </Shell>
    );
  }

  if (!authorizationId) {
    return (
      <Shell title="Invalid request">
        <p>
          Missing <code className="text-cyan-400/90">authorization_id</code> query
          parameter.
        </p>
      </Shell>
    );
  }

  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const nextPath =
      "/oauth/consent?authorization_id=" + encodeURIComponent(authorizationId);
    redirect("/login?next=" + encodeURIComponent(nextPath));
  }

  const { data: detailsOrRedirect, error } =
    await supabase.auth.oauth.getAuthorizationDetails(authorizationId);

  if (error || !detailsOrRedirect) {
    return (
      <Shell title="Cannot complete authorization">
        <p>{error?.message ?? "Invalid or expired authorization request."}</p>
      </Shell>
    );
  }

  if ("redirect_url" in detailsOrRedirect) {
    redirect(detailsOrRedirect.redirect_url);
  }

  const authDetails = detailsOrRedirect;
  const clientName = authDetails.client.name;
  const redirectUri = authDetails.redirect_uri;
  const scopeStr = authDetails.scope?.trim() ?? "";
  const scopes = scopeStr ? scopeStr.split(/\s+/).filter(Boolean) : [];

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-slate-50">
      <div className="glass-terminal w-full max-w-lg rounded-lg border p-6">
        <h1 className="text-lg font-semibold tracking-tight text-slate-100">
          Authorize {clientName}
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          This application wants to access your account using your Supabase identity.
        </p>
        <dl className="mt-6 space-y-3 text-sm">
          <div>
            <dt className="text-slate-500">Client</dt>
            <dd className="text-slate-200">{clientName}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Redirect URI</dt>
            <dd className="break-all text-slate-200">{redirectUri}</dd>
          </div>
        </dl>
        {scopes.length > 0 ? (
          <div className="mt-6">
            <p className="text-sm font-medium text-slate-300">Requested permissions</p>
            <ul className="mt-2 list-inside list-disc text-sm text-slate-400">
              {scopes.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <form
          className="mt-8 flex flex-wrap gap-3"
          action="/api/oauth/decision"
          method="POST"
        >
          <input type="hidden" name="authorization_id" value={authorizationId} />
          <button
            type="submit"
            name="decision"
            value="approve"
            className="rounded-md border border-emerald-500/40 bg-emerald-950/40 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-900/50"
          >
            Approve
          </button>
          <button
            type="submit"
            name="decision"
            value="deny"
            className="rounded-md border border-white/15 bg-zinc-900/80 px-4 py-2 text-sm text-slate-200 transition hover:bg-zinc-800"
          >
            Deny
          </button>
        </form>
      </div>
    </div>
  );
}
