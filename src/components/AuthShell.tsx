export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold tracking-tight"><span className="inline-block h-6 w-6 rounded-md bg-brand-600" aria-hidden />KudoBird</h1>
      <p className="mb-6 text-sm text-neutral-600">{title}</p>
      <div className="card space-y-4">{children}</div>
    </main>
  );
}
export function Notice({ kind, children }: { kind: "error" | "info"; children: React.ReactNode }) {
  return <p className={`rounded-lg p-3 text-sm ${kind === "error" ? "border border-red-100 bg-red-50 text-red-700" : "border border-green-100 bg-green-50 text-green-800"}`}>{children}</p>;
}
