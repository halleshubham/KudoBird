import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../env";
import { getRedis } from "./ratelimit";

/** SMS/WhatsApp OTP provider. v1 ships only a console logger; plug MSG91/Twilio in behind this interface. */
export interface OtpProvider {
  send(mobileE164: string, code: string): Promise<void>;
}

class ConsoleOtpProvider implements OtpProvider {
  static sent: { mobile: string; code: string }[] = [];
  async send(mobile: string, code: string) {
    ConsoleOtpProvider.sent.push({ mobile, code });
    if (process.env.NODE_ENV !== "test") console.log(`[otp] ${mobile} -> ${code}`);
  }
}
export const lastOtp = () => ConsoleOtpProvider.sent.at(-1);

let provider: OtpProvider = new ConsoleOtpProvider();
export const setOtpProvider = (p: OtpProvider) => { provider = p; };

const mem = new Map<string, { code: string; exp: number; tries: number }>();
const TTL = 300;
const sign = (payload: string) => createHmac("sha256", env().AUTH_SECRET).update("otp:" + payload).digest("base64url");

export async function sendOtp(campaignId: string, mobile: string): Promise<void> {
  const code = String(randomInt(100000, 1000000));
  const key = `otp:${campaignId}:${mobile}`;
  const r = getRedis();
  const value = JSON.stringify({ code, tries: 0 });
  if (r) { try { await r.set(key, value, "EX", TTL); } catch { mem.set(key, { code, exp: Date.now() + TTL * 1000, tries: 0 }); } }
  else mem.set(key, { code, exp: Date.now() + TTL * 1000, tries: 0 });
  await provider.send(mobile, code);
}

/** On success returns a signed token that the form submit must present (proves the mobile was verified). */
export async function verifyOtp(campaignId: string, mobile: string, code: string): Promise<string | null> {
  const key = `otp:${campaignId}:${mobile}`;
  const r = getRedis();
  let stored: { code: string; tries: number } | null = null;
  if (r) { try { const v = await r.get(key); stored = v ? JSON.parse(v) : null; } catch { /* memory */ } }
  if (!stored) { const m = mem.get(key); if (m && m.exp > Date.now()) stored = m; }
  if (!stored || stored.tries >= 5) return null;
  const ok = stored.code.length === code.length && timingSafeEqual(Buffer.from(stored.code), Buffer.from(code));
  if (!ok) {
    if (r) { try { await r.set(key, JSON.stringify({ ...stored, tries: stored.tries + 1 }), "KEEPTTL"); } catch { /* ignore */ } }
    else (mem.get(key)!).tries++;
    return null;
  }
  if (r) { try { await r.del(key); } catch { /* ignore */ } }
  mem.delete(key);
  const exp = Math.floor(Date.now() / 1000) + 1800;
  const payload = `${campaignId}.${mobile}.${exp}`;
  return `${exp}.${sign(payload)}`;
}

export function checkOtpToken(campaignId: string, mobile: string, token: string | undefined): boolean {
  if (!token) return false;
  const [expStr, sig] = token.split(".");
  const exp = Number(expStr);
  if (!exp || exp < Date.now() / 1000 || !sig) return false;
  const expected = sign(`${campaignId}.${mobile}.${exp}`);
  return expected.length === sig.length && timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}
