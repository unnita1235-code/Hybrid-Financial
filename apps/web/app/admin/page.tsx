export default function AdminPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <h1 className="text-lg font-semibold text-slate-100">Admin panel</h1>
      <p className="mt-1 text-sm text-slate-500">
        Trigger ingestion jobs and monitor system health from a single control panel.
      </p>
      <div className="mt-4 glass-terminal rounded-xl p-4 text-sm text-slate-300">
        Admin controls are scaffolded. Next step is wiring ingest trigger and health
        cards.
      </div>
    </div>
  );
}
