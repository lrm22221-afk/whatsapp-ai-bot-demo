import { createHmac, timingSafeEqual } from "node:crypto";
import type { SendResult } from "./graph.js";

/**
 * X-Twilio-Signature, per Twilio's documented algorithm (twilio.com/docs/usage/security):
 * full URL (incl. query string) + each POST param name and value, sorted by name (case-sensitive),
 * HMAC-SHA1 with the Auth Token, Base64-encoded.
 */
export function twilioSignature(url: string, params: Record<string, string>, authToken: string): string {
  const data = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf8")).digest("base64");
}

export function verifyTwilioSignature(url: string, params: Record<string, string>, header: string | undefined, authToken: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(twilioSignature(url, params, authToken));
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export interface TwilioConfig { accountSid: string; authToken: string; from: string; apiBaseUrl: string }

/** Sends WhatsApp messages through the Twilio Messages API (form-encoded, HTTP Basic auth). */
export class TwilioClient {
  constructor(private cfg: TwilioConfig, private fetchImpl: typeof fetch = fetch, private maxAttempts = 3, private backoffMs = 200) {}

  private get url() { return `${this.cfg.apiBaseUrl}/2010-04-01/Accounts/${this.cfg.accountSid}/Messages.json`; }

  static wa(n: string) { return n.startsWith("whatsapp:") ? n : `whatsapp:${n.startsWith("+") ? n : `+${n}`}`; }

  async post(params: Record<string, string>): Promise<SendResult> {
    const auth = Buffer.from(`${this.cfg.accountSid}:${this.cfg.authToken}`).toString("base64");
    let last: SendResult = { ok: false, status: 0 };
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const res = await this.fetchImpl(this.url, {
          method: "POST",
          headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ From: TwilioClient.wa(this.cfg.from), ...params }).toString(),
        });
        const body = (await res.json().catch(() => ({}))) as any;
        last = { ok: res.ok, status: res.status, messageId: body?.sid, error: body?.message };
        if (res.ok || (res.status !== 429 && res.status < 500)) return last;
      } catch (e) { last = { ok: false, status: 0, error: (e as Error).message }; }
      if (attempt < this.maxAttempts) await new Promise((r) => setTimeout(r, this.backoffMs * attempt));
    }
    return last;
  }

  sendText(to: string, body: string) { return this.post({ To: TwilioClient.wa(to), Body: body }); }

  /** Outside the 24h window Twilio requires an approved Content template; `name` is its Content SID (HX...). */
  sendTemplate(to: string, contentSid: string, _lang: string) { return this.post({ To: TwilioClient.wa(to), ContentSid: contentSid }); }
}
