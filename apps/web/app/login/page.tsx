import { LoginForm } from "./login-form";

type Props = {
  searchParams: Promise<{ next?: string }>;
};

export default async function LoginPage({ searchParams }: Props) {
  const { next } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-4 text-slate-50">
      <div className="glass-terminal w-full max-w-md rounded-lg border p-6">
        <h1 className="text-lg font-semibold tracking-tight text-slate-100">Sign in</h1>
        <p className="mt-1 text-sm text-slate-500">
          Use the email and password for your Supabase user (enable Email in Authentication
          → Providers).
        </p>
        <LoginForm defaultNext={next} />
      </div>
    </div>
  );
}
