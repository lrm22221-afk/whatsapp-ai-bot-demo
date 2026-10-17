import { detectLanguage, type Lang } from "./lang.js";
import { hasUngroundedPrice, isPromptInjection } from "./guardrails.js";
import type { Generator, Retriever } from "./rag.js";
import type { AppointmentRecord, Session, Store } from "./store.js";

export type Intent = "opt_out" | "opt_in" | "injection" | "handoff" | "greeting" | "appointment" | "faq" | "fallback_handoff" | "silent";
export interface Reply { intent: Intent; text?: string; appointment?: AppointmentRecord }

const T = {
  greeting: { en: "Hi! I'm the virtual assistant of Ofek Dental Clinic (demo). I can answer questions about hours, address, prices and insurance, request an appointment (write \"appointment\"), or connect you to a human (write \"human\"). Reply STOP to unsubscribe.",
              he: "שלום! אני העוזר הווירטואלי של מרפאת אופק (דמו). אפשר לשאול על שעות, כתובת, מחירים וביטוח, לבקש תור (כתבו \"תור\") או לדבר עם נציג (כתבו \"נציג\"). להסרה השיבו STOP." },
  optOut: { en: "You have been unsubscribed and will not receive more messages. Reply START to subscribe again.",
            he: "הוסרת מרשימת התפוצה ולא תקבל/י הודעות נוספות. להצטרפות מחדש השיבו START." },
  optIn: { en: "Welcome back! You are subscribed again.", he: "ברוכים השבים! נרשמת מחדש." },
  injection: { en: "Sorry, I can't do that. I can only help with clinic information, appointments, or connecting you to our team.",
               he: "מצטער, אין באפשרותי לעשות זאת. אני יכול לעזור רק במידע על המרפאה, בקביעת תורים או בחיבור לצוות." },
  handoff: { en: "I'm passing you to a member of our team. Someone will reply here during opening hours.",
             he: "אני מעביר אותך לנציג מהצוות. נחזור אליך כאן בשעות הפעילות." },
  noAnswer: { en: "I don't have verified information about that, so I won't guess. I've passed your question to our team and they will reply here.",
              he: "אין לי מידע מאומת על כך, ולכן לא אנחש. העברתי את השאלה לצוות והם יחזרו אליך כאן." },
  askName: { en: "Sure, let's request an appointment. What is your full name?", he: "בשמחה, נקבע בקשה לתור. מה השם המלא שלך?" },
  askDate: { en: "Which date? (e.g. 24/10 or tomorrow)", he: "לאיזה תאריך? (למשל 24/10 או מחר)" },
  askTime: { en: "What time? (e.g. 10:30)", he: "באיזו שעה? (למשל 10:30)" },
  cancelled: { en: "OK, the appointment request was cancelled.", he: "בסדר, בקשת התור בוטלה." },
} satisfies Record<string, Record<Lang, string>>;

const RX = {
  optOut: /^\s*(stop|unsubscribe|הסר|הסרה|עצור)\s*[.!]?\s*$/i,
  optIn: /^\s*(start|הרשמה)\s*[.!]?\s*$/i,
  handoff: /\b(human|agent|representative|real person|operator)\b|נציג|בן אדם|אדם אמיתי/i,
  greeting: /^\s*(hi|hello|hey|good (morning|evening)|שלום|היי|הי|בוקר טוב|ערב טוב)\s*[!.]?\s*$/i,
  appointment: /\b(appointment|book|schedule)\b|(^|\s)(תור|לקבוע|לזמן)/i,
  cancel: /^\s*(cancel|בטל|ביטול)\s*$/i,
  // Questions *about* cancelling/rescheduling are FAQ, not a new booking.
  policy: /\b(cancel|reschedul\w*|policy)\b|לבטל|מבטלים|להזיז|מזיזים|ביטולים/i,
};

export function parseDate(text: string, now: Date): string | undefined {
  const pad = (n: number) => String(n).padStart(2, "0");
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (/\b(tomorrow)\b|מחר/i.test(text)) return iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  if (/\b(today)\b|היום/i.test(text)) return iso(now);
  let m = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = text.match(/\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b/);
  if (m) {
    const day = +m[1], month = +m[2];
    let year = m[3] ? +m[3] : now.getFullYear();
    if (year < 100) year += 2000;
    if (!m[3] && new Date(year, month - 1, day) < new Date(now.getFullYear(), now.getMonth(), now.getDate())) year++;
    return valid(year, month, day);
  }
  return undefined;
  function valid(y: number, mo: number, d: number) {
    const dt = new Date(y, mo - 1, d);
    return dt.getMonth() === mo - 1 && dt.getDate() === d ? iso(dt) : undefined;
  }
}

export function parseTime(text: string): string | undefined {
  let m = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m) return `${m[1].padStart(2, "0")}:${m[2]}`;
  m = text.match(/\b(1[0-2]|0?[1-9])\s*(am|pm)\b/i);
  if (m) { let h = +m[1] % 12; if (m[2].toLowerCase() === "pm") h += 12; return `${String(h).padStart(2, "0")}:00`; }
  return undefined;
}

export function parseName(text: string): string | undefined {
  const m = text.match(/(?:my name is|i am|i'm|this is)\s+([\p{L}' -]{2,40})/iu) ?? text.match(/(?:שמי|קוראים לי|השם שלי)\s+([\p{L}' -]{2,40})/u);
  return m ? m[1].trim() : undefined;
}

export class Assistant {
  constructor(private store: Store, private retriever: Retriever, private generator: Generator,
              private minScore = 0.4, private now: () => Date = () => new Date()) {}

  async handle(session: Session, text: string): Promise<Reply> {
    const lang: Lang = detectLanguage(text, session.lang);
    session.lang = lang;

    if (RX.optOut.test(text)) { session.optedOut = true; session.draft = undefined; return { intent: "opt_out", text: T.optOut[lang] }; }
    if (session.optedOut) {
      if (RX.optIn.test(text)) { session.optedOut = false; return { intent: "opt_in", text: T.optIn[lang] }; }
      return { intent: "silent" }; // opted-out users get no automated replies
    }
    if (isPromptInjection(text)) return { intent: "injection", text: T.injection[lang] };
    if (RX.handoff.test(text)) return this.handoff(session, "customer asked for a human", T.handoff[lang]);
    if (session.handoff) return { intent: "silent" }; // a human owns the conversation now

    if (session.draft || (RX.appointment.test(text) && !RX.policy.test(text))) return this.appointment(session, text, lang);
    if (RX.greeting.test(text)) return { intent: "greeting", text: T.greeting[lang] };
    return this.faq(session, text, lang);
  }

  private handoff(session: Session, reason: string, text: string, intent: Intent = "handoff"): Reply {
    session.handoff = true;
    session.draft = undefined;
    this.store.handoffQueue.push({ phone: session.phone, reason, at: this.now().toISOString() });
    return { intent, text };
  }

  private async faq(session: Session, text: string, lang: Lang): Promise<Reply> {
    const [top] = await this.retriever.search(text, 1);
    if (!top || top.score < this.minScore) return this.handoff(session, `low confidence (${top?.score.toFixed(2)}): ${text}`, T.noAnswer[lang], "fallback_handoff");
    const context = lang === "he" ? top.entry.a_he : top.entry.a_en;
    let answer: string;
    try { answer = await this.generator.answer(text, context, lang); } catch { answer = context; }
    if (!answer || answer.includes("NO_ANSWER") || hasUngroundedPrice(answer, context))
      return this.handoff(session, `ungrounded answer blocked: ${text}`, T.noAnswer[lang], "fallback_handoff");
    return { intent: "faq", text: answer };
  }

  private appointment(session: Session, text: string, lang: Lang): Reply {
    if (RX.cancel.test(text)) { session.draft = undefined; return { intent: "appointment", text: T.cancelled[lang] }; }
    const starting = !session.draft;
    const d = (session.draft ??= {});
    const awaiting = d.name === undefined ? "name" : d.date === undefined ? "date" : "time";
    d.name ??= parseName(text) ?? (!starting && awaiting === "name" && text.trim().split(/\s+/).length <= 4 ? text.trim() : undefined);
    d.date ??= parseDate(text, this.now());
    d.time ??= parseTime(text);
    if (!d.name) return { intent: "appointment", text: T.askName[lang] };
    if (!d.date) return { intent: "appointment", text: T.askDate[lang] };
    if (!d.time) return { intent: "appointment", text: T.askTime[lang] };

    const record: AppointmentRecord = {
      id: `apt_${this.store.appointments.length + 1}`, phone: session.phone, name: d.name, date: d.date, time: d.time,
      language: lang, status: "requested", createdAt: this.now().toISOString(),
    };
    this.store.appointments.push(record);
    session.draft = undefined;
    const msg = lang === "he"
      ? `תודה ${record.name}! רשמתי בקשה לתור ב-${record.date} בשעה ${record.time}. הצוות יאשר את התור כאן. (מספר בקשה: ${record.id})`
      : `Thanks ${record.name}! I've recorded an appointment request for ${record.date} at ${record.time}. Our team will confirm it here. (Request id: ${record.id})`;
    return { intent: "appointment", text: msg, appointment: record };
  }
}
