import type { Lang } from "./lang.js";

export interface AppointmentRecord {
  id: string; phone: string; name: string; date: string; time: string;
  language: Lang; status: "requested"; createdAt: string;
}

export interface Session {
  phone: string;
  lang: Lang;
  lastInboundAt: number;       // ms epoch of the last customer message (24h window anchor)
  optedOut: boolean;
  handoff: boolean;            // true while a human owns the conversation
  draft?: Partial<Pick<AppointmentRecord, "name" | "date" | "time">>;
}

export interface StatusEvent { messageId: string; status: string; recipient: string; timestamp: number; errors?: unknown }

/** In-memory stores. Swap for Redis/Postgres in a real deployment. */
export class Store {
  sessions = new Map<string, Session>();
  appointments: AppointmentRecord[] = [];
  statuses: StatusEvent[] = [];
  handoffQueue: { phone: string; reason: string; at: string }[] = [];

  session(phone: string, lang: Lang): Session {
    let s = this.sessions.get(phone);
    if (!s) { s = { phone, lang, lastInboundAt: 0, optedOut: false, handoff: false }; this.sessions.set(phone, s); }
    return s;
  }
}
