import { Logo } from "./Logo";

export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4 py-10">
      <h1 className="mb-1 text-2xl"><Logo size={36} /></h1>
      <p className="mb-6 text-sm text-neutral-600">{title}</p>
      <div className="card space-y-4">{children}</div>
    </main>
  );
}
export function Notice({ kind, children }: { kind: "error" | "info"; children: React.ReactNode }) {
  return <p role={kind === "error" ? "alert" : "status"} className={`rounded-lg p-3 text-sm ${kind === "error" ? "border border-red-100 bg-red-50 text-red-700" : "border border-green-100 bg-green-50 text-green-800"}`}>{children}</p>;
}
