import type { Config } from "./config.js";

export interface SendResult { ok: boolean; status: number; messageId?: string; error?: string }

/** Minimal client for the WhatsApp Cloud API /{phone-number-id}/messages endpoint. */
export class GraphClient {
  constructor(private cfg: Pick<Config, "graphBaseUrl" | "graphApiVersion" | "phoneNumberId" | "accessToken">,
              private fetchImpl: typeof fetch = fetch, private maxAttempts = 3, private backoffMs = 200) {}

  private get url(): string {
    return `${this.cfg.graphBaseUrl}/${this.cfg.graphApiVersion}/${this.cfg.phoneNumberId}/messages`;
  }

  async post(payload: Record<string, unknown>): Promise<SendResult> {
    let last: SendResult = { ok: false, status: 0 };
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const res = await this.fetchImpl(this.url, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.cfg.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
        });
        const body = (await res.json().catch(() => ({}))) as any;
        last = { ok: res.ok, status: res.status, messageId: body?.messages?.[0]?.id, error: body?.error?.message };
        // Retry only on rate limiting and server errors; 4xx means the request itself is wrong.
        if (res.ok || (res.status !== 429 && res.status < 500)) return last;
      } catch (e) {
        last = { ok: false, status: 0, error: (e as Error).message };
      }
      if (attempt < this.maxAttempts) await new Promise((r) => setTimeout(r, this.backoffMs * attempt));
    }
    return last;
  }

  sendText(to: string, body: string): Promise<SendResult> {
    return this.post({ recipient_type: "individual", to, type: "text", text: { body, preview_url: false } });
  }

  sendTemplate(to: string, name: string, languageCode: string): Promise<SendResult> {
    return this.post({ recipient_type: "individual", to, type: "template", template: { name, language: { code: languageCode } } });
  }

  markRead(messageId: string): Promise<SendResult> {
    return this.post({ status: "read", message_id: messageId });
  }
}
