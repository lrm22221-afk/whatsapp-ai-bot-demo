import type { SendResult } from "./graph.js";

/** What the bot needs from a WhatsApp provider (Meta Cloud API or Twilio). */
export interface Outbound {
  sendText(to: string, body: string): Promise<SendResult>;
  sendTemplate(to: string, name: string, languageCode: string): Promise<SendResult>;
}
import type { Session } from "./store.js";

export const WINDOW_MS = 24 * 60 * 60 * 1000;

export type Outcome = SendResult | { ok: false; status: 0; error: string; blocked: true };

/**
 * Enforces WhatsApp's customer-service window: free-form text only within 24h of the
 * customer's last message; outside it, only pre-approved templates. Never messages opted-out users.
 */
export class Messenger {
  constructor(private graph: Outbound, private approvedTemplates: string[], private now: () => number = Date.now) {}

  insideWindow(s: Session): boolean { return s.lastInboundAt > 0 && this.now() - s.lastInboundAt < WINDOW_MS; }

  async text(s: Session, body: string): Promise<Outcome> {
    if (s.optedOut) return blocked("recipient opted out");
    if (!this.insideWindow(s)) return blocked("outside 24h customer-service window: use an approved template");
    return this.graph.sendText(s.phone, body);
  }

  async template(s: Session, name: string): Promise<Outcome> {
    if (s.optedOut) return blocked("recipient opted out");
    if (!this.approvedTemplates.includes(name)) return blocked(`template "${name}" is not in APPROVED_TEMPLATES`);
    return this.graph.sendTemplate(s.phone, name, s.lang === "he" ? "he" : "en_US");
  }
}

function blocked(error: string): Outcome { return { ok: false, status: 0, error, blocked: true }; }
