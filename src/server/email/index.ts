import { render } from "@react-email/render";
import type { ReactElement } from "react";
import { Resend } from "resend";
import { env } from "../env";

export interface OutgoingEmail {
  to: string;
  subject: string;
  react: ReactElement;
  attachments?: { filename: string; content: Buffer }[];
  tags?: Record<string, string>;
}

export interface EmailTransport {
  send(msg: { from: string; to: string; subject: string; html: string; text: string; attachments?: OutgoingEmail["attachments"]; tags?: Record<string, string> }): Promise<{ id?: string }>;
}

class ResendTransport implements EmailTransport {
  private client = new Resend(env().RESEND_API_KEY);
  async send(msg: Parameters<EmailTransport["send"]>[0]) {
    const { data, error } = await this.client.emails.send({
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      attachments: msg.attachments,
      tags: msg.tags ? Object.entries(msg.tags).map(([name, value]) => ({ name, value })) : undefined,
    });
    if (error) throw new Error(`Resend error: ${error.message}`);
    return { id: data?.id };
  }
}

/** Development transport: prints the email instead of sending it. */
class ConsoleTransport implements EmailTransport {
  static outbox: { to: string; subject: string; text: string }[] = [];
  async send(msg: Parameters<EmailTransport["send"]>[0]) {
    ConsoleTransport.outbox.push({ to: msg.to, subject: msg.subject, text: msg.text });
    if (process.env.NODE_ENV !== "test") console.log(`\n[email] to=${msg.to} subject="${msg.subject}"\n${msg.text}\n`);
    return { id: `console-${Date.now()}` };
  }
}

let transport: EmailTransport | undefined;

export function setEmailTransport(t: EmailTransport | undefined) {
  transport = t;
}
export const consoleOutbox = () => ConsoleTransport.outbox;

/**
 * The ONLY entry point for sending email. Uses Resend when RESEND_API_KEY is set,
 * otherwise logs to the console so local development needs no account.
 */
export async function sendEmail(msg: OutgoingEmail): Promise<{ id?: string }> {
  transport ??= env().RESEND_API_KEY ? new ResendTransport() : new ConsoleTransport();
  const [html, text] = await Promise.all([render(msg.react), render(msg.react, { plainText: true })]);
  return transport.send({ from: env().EMAIL_FROM, to: msg.to, subject: msg.subject, html, text, attachments: msg.attachments, tags: msg.tags });
}
