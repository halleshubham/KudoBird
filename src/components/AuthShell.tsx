export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="mb-1 text-2xl font-bold text-brand-700">KudoBird</h1>
      <p className="mb-6 text-sm text-gray-600">{title}</p>
      <div className="card space-y-4">{children}</div>
    </main>
  );
}
export function Notice({ kind, children }: { kind: "error" | "info"; children: React.ReactNode }) {
  return <p className={`rounded-md p-2 text-sm ${kind === "error" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"}`}>{children}</p>;
}
