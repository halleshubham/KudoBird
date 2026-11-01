import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession } from "@/server/session";

const STEPS = [
  ["1", "Create a campaign", "Name it, pick Marathi, Hindi or English and share one public link."],
  ["2", "Design the certificate", "Start from a layout, add logos, signatures and your own background."],
  ["3", "Issue and share", "Participants fill the form, the certificate is rendered and ready to share."],
];

export default async function Home() {
  if (await currentSession()) redirect("/app");
  return (
    <main className="mx-auto max-w-5xl px-4">
      <header className="flex items-center justify-between py-5">
        <span className="flex items-center gap-2 text-lg font-bold tracking-tight"><span className="inline-block h-5 w-5 rounded-md bg-brand-600" aria-hidden />KudoBird</span>
        <nav className="flex items-center gap-2"><Link href="/login" className="btn-ghost">Sign in</Link><Link href="/signup" className="btn">Sign up</Link></nav>
      </header>
      <section className="py-16 text-center sm:py-24">
        <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-[1.1] sm:text-6xl">
          Thank everyone with<br /><span className="text-brand-600">beautiful certificates</span>
        </h1>
        <ul className="mx-auto mt-8 max-w-md space-y-2 text-left text-neutral-700">
          {["Perfect Marathi and Hindi lettering", "One link, a form, and certificates in seconds", "Share to WhatsApp, LinkedIn and more"].map((t) => (
            <li key={t} className="flex gap-2"><span className="text-brand-600" aria-hidden>✓</span>{t}</li>
          ))}
        </ul>
        <div className="mt-8 flex flex-col items-center gap-3">
          <Link href="/signup" className="btn !px-6 !py-3 !text-base">Get started for free →</Link>
          <p className="text-sm text-neutral-500">Free for now. No credit card required.</p>
        </div>
      </section>
      <section className="grid gap-4 pb-20 sm:grid-cols-3">
        {STEPS.map(([n, title, text]) => (
          <div key={n} className="card">
            <span className="mb-3 flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">{n}</span>
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-neutral-600">{text}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
