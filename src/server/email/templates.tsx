import { Body, Button, Container, Head, Html, Preview, Text } from "@react-email/components";
import * as React from "react";

interface ActionEmailProps {
  preview: string;
  heading: string;
  body: string;
  actionLabel: string;
  actionUrl: string;
  footer?: string;
}

/** Generic call-to-action email used by verification, magic link, reset and invite mails. */
export function ActionEmail({ preview, heading, body, actionLabel, actionUrl, footer }: ActionEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ fontFamily: "system-ui, sans-serif", background: "#f6f6f4", padding: "24px" }}>
        <Container style={{ background: "#fff", borderRadius: 8, padding: 32, maxWidth: 480 }}>
          <Text style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{heading}</Text>
          <Text style={{ fontSize: 15, lineHeight: "22px" }}>{body}</Text>
          <Button
            href={actionUrl}
            style={{ background: "#7c3aed", color: "#fff", padding: "12px 20px", borderRadius: 6, fontWeight: 600 }}
          >
            {actionLabel}
          </Button>
          <Text style={{ fontSize: 12, color: "#666" }}>{footer ?? "If you did not expect this email, you can ignore it."}</Text>
        </Container>
      </Body>
    </Html>
  );
}

const shell = { fontFamily: "system-ui, 'Noto Sans Devanagari', 'Mukta', sans-serif", background: "#f6f6f4", padding: "24px" } as const;
const card = { background: "#fff", borderRadius: 8, padding: 32, maxWidth: 520 } as const;

/** Certificate delivery / rejection notice to a contributor. Subject and intro come from per-campaign text or localised defaults. */
export function ContributorEmail({ locale, hello, intro, note, buttonLabel, url, footer, accent }: {
  locale: string; hello: string; intro: string; note?: string; buttonLabel?: string; url?: string; footer: string; accent?: string;
}) {
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{intro}</Preview>
      <Body style={shell}>
        <Container style={card}>
          <Text style={{ fontSize: 16, margin: "0 0 8px" }}>{hello}</Text>
          <Text style={{ fontSize: 15, lineHeight: "24px", whiteSpace: "pre-line" }}>{intro}</Text>
          {note && <Text style={{ fontSize: 13, color: "#555" }}>{note}</Text>}
          {url && buttonLabel && (
            <Button href={url} style={{ background: accent ?? "#7c3aed", color: "#fff", padding: "12px 20px", borderRadius: 6, fontWeight: 600 }}>{buttonLabel}</Button>
          )}
          <Text style={{ fontSize: 12, color: "#777", marginTop: 24 }}>{footer}</Text>
        </Container>
      </Body>
    </Html>
  );
}

/** Notification to org members about new entries (instant: one entry; digest: several). */
export function AdminEntriesEmail({ heading, lines, actionLabel, actionUrl }: { heading: string; lines: string[]; actionLabel: string; actionUrl: string }) {
  return (
    <Html>
      <Head />
      <Preview>{heading}</Preview>
      <Body style={shell}>
        <Container style={card}>
          <Text style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{heading}</Text>
          {lines.map((l, i) => <Text key={i} style={{ fontSize: 14, margin: "4px 0" }}>• {l}</Text>)}
          <Button href={actionUrl} style={{ background: "#7c3aed", color: "#fff", padding: "10px 18px", borderRadius: 6, fontWeight: 600, marginTop: 16 }}>{actionLabel}</Button>
          <Text style={{ fontSize: 12, color: "#777", marginTop: 24 }}>You can change how often you get these in Settings → Notifications.</Text>
        </Container>
      </Body>
    </Html>
  );
}
