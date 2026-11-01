/** Bot-check provider. Cloudflare Turnstile in production; no-op when no secret is configured (dev/tests). */
export interface CaptchaVerifier {
  readonly enabled: boolean;
  verify(token: string | undefined, ip?: string): Promise<boolean>;
}

class TurnstileVerifier implements CaptchaVerifier {
  readonly enabled = true;
  constructor(private secret: string) {}
  async verify(token: string | undefined, ip?: string) {
    if (!token) return false;
    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (ip) body.set("remoteip", ip);
    try {
      const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
      return ((await res.json()) as { success: boolean }).success === true;
    } catch {
      return false; // fail closed
    }
  }
}

class NoopVerifier implements CaptchaVerifier {
  readonly enabled = false;
  async verify() { return true; }
}

let current: CaptchaVerifier | undefined;
export const getCaptcha = (): CaptchaVerifier => (current ??= process.env.TURNSTILE_SECRET_KEY ? new TurnstileVerifier(process.env.TURNSTILE_SECRET_KEY) : new NoopVerifier());
export const setCaptcha = (c: CaptchaVerifier | undefined) => { current = c; };
