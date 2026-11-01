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
