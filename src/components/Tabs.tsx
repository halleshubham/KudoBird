import Link from "next/link";

export function CampaignTabs({ id, active }: { id: string; active: "overview" | "form" | "design" | "entries" }) {
  const tabs = [
    ["overview", "Overview", `/app/campaigns/${id}`],
    ["form", "Form", `/app/campaigns/${id}/form`],
    ["design", "Certificate design", `/app/campaigns/${id}/design`],
    ["entries", "Entries", `/app/campaigns/${id}/entries`],
  ] as const;
  return (
    <nav className="flex gap-1 overflow-x-auto border-b text-sm">
      {tabs.map(([key, label, href]) => (
        <Link key={key} href={href} className={`whitespace-nowrap px-3 py-2 ${active === key ? "border-b-2 border-brand-600 font-semibold text-brand-700" : "text-gray-600"}`}>{label}</Link>
      ))}
    </nav>
  );
}
