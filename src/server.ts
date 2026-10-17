import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Config } from "./config.js";
import { verifySignature } from "./signature.js";
import { Deduper } from "./dedupe.js";
import { GraphClient } from "./graph.js";
import { Messenger, type Outbound } from "./messenger.js";
import { TwilioClient, verifyTwilioSignature } from "./twilio.js";
import { Assistant } from "./assistant.js";
import { Store } from "./store.js";
import { detectLanguage } from "./lang.js";
import type { Generator, Retriever } from "./rag.js";

export interface AppDeps { cfg: Config; retriever: Retriever; generator: Generator; now?: () => number; log?: (...a: unknown[]) => void }
export interface App { server: Server; store: Store; deduper: Deduper; idle: () => Promise<void> }

const UNSUPPORTED = {
  en: "Sorry, I can only read text messages. Please type your question.",
  he: "מצטער, אני יכול לקרוא רק הודעות טקסט. אנא כתבו את השאלה.",
};

export function createApp({ cfg, retriever, generator, now = Date.now, log = () => {} }: AppDeps): App {
  const store = new Store();
  const deduper = new Deduper(24 * 60 * 60 * 1000, now);
  const graph = new GraphClient(cfg);
  const twilio = cfg.provider === "twilio" && cfg.twilio ? new TwilioClient(cfg.twilio) : undefined;
  const outbound: Outbound = twilio ?? graph;
  const messenger = new Messenger(outbound, cfg.approvedTemplates, now);
  const assistant = new Assistant(store, retriever, generator, cfg.faqMinScore, () => new Date(now()));
  const pending = new Set<Promise<void>>();

  const track = (p: Promise<void>) => { pending.add(p); p.finally(() => pending.delete(p)); };

  async function processMessage(msg: any, contactName?: string): Promise<void> {
    const text: string | undefined =
      msg.type === "text" ? msg.text?.body
      : msg.type === "interactive" ? (msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title)
      : msg.type === "button" ? msg.button?.text : undefined;
    await graph.markRead(msg.id);
    // The 24h window is anchored on the customer's own message timestamp (seconds since epoch).
    await processInbound(msg.from, text, Number(msg.timestamp) * 1000 || now(), contactName);
  }

  /** Provider-independent handling of one inbound customer message. */
  async function processInbound(phone: string, text: string | undefined, receivedAt: number, contactName?: string): Promise<void> {
    const session = store.session(phone, detectLanguage(text ?? "", "he"));
    session.lastInboundAt = Math.max(session.lastInboundAt, receivedAt);
    if (!text) { if (!session.optedOut) await messenger.text(session, UNSUPPORTED[session.lang]); return; }
    const reply = await assistant.handle(session, text);
    log("message", { from: phone, name: contactName, intent: reply.intent });
    if (reply.text) {
      // Opt-out confirmation is the one message we still send to a user who just opted out.
      const r = reply.intent === "opt_out" ? await outbound.sendText(phone, reply.text) : await messenger.text(session, reply.text);
      if (!r.ok) log("send failed", r);
    }
  }

  function handleWebhook(body: any): void {
    if (body?.object !== "whatsapp_business_account") return;
    for (const entry of body.entry ?? []) for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const st of value.statuses ?? []) {
        store.statuses.push({ messageId: st.id, status: st.status, recipient: st.recipient_id, timestamp: Number(st.timestamp), errors: st.errors });
        if (st.status === "failed") log("delivery failed", st.id, JSON.stringify(st.errors));
      }
      const contactName = value.contacts?.[0]?.profile?.name;
      for (const msg of value.messages ?? []) {
        if (!deduper.firstTime(msg.id)) { log("duplicate ignored", msg.id); continue; }
        track(processMessage(msg, contactName).catch((e) => log("processing error", e)));
      }
    }
  }

  async function route(req: IncomingMessage, res: ServerResponse, raw: Buffer): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (code: number, data: unknown, type = "application/json") => {
      res.writeHead(code, { "Content-Type": type });
      res.end(type === "application/json" ? JSON.stringify(data) : String(data));
    };

    if (url.pathname === "/health") return send(200, { ok: true });

    if (url.pathname === "/webhook" && req.method === "GET") {
      const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === cfg.verifyToken;
      return ok ? send(200, url.searchParams.get("hub.challenge") ?? "", "text/plain") : send(403, { error: "verification failed" });
    }

    if (url.pathname === "/webhook" && req.method === "POST") {
      if (!verifySignature(raw, req.headers["x-hub-signature-256"] as string | undefined, cfg.appSecret))
        return send(401, { error: "invalid signature" });
      let body: unknown;
      try { body = JSON.parse(raw.toString("utf8")); } catch { return send(400, { error: "invalid json" }); }
      handleWebhook(body);
      return send(200, { received: true }); // acknowledge fast; replies are sent asynchronously
    }

    if (url.pathname === "/twilio/webhook" && req.method === "POST" && twilio && cfg.twilio) {
      const params = Object.fromEntries(new URLSearchParams(raw.toString("utf8")));
      // Twilio signs the public URL it called; behind a tunnel/proxy set TWILIO_WEBHOOK_URL to that exact URL.
      const publicUrl = cfg.twilio.webhookUrl ??
        `${(req.headers["x-forwarded-proto"] as string) ?? "http"}://${(req.headers["x-forwarded-host"] as string) ?? req.headers.host}${req.url}`;
      if (!verifyTwilioSignature(publicUrl, params, req.headers["x-twilio-signature"] as string | undefined, cfg.twilio.authToken))
        return send(403, { error: "invalid Twilio signature" });
      if (params.MessageStatus && !params.Body && !params.NumMedia) {
        // Status callback (queued/sent/delivered/read/failed/undelivered)
        store.statuses.push({ messageId: params.MessageSid, status: params.MessageStatus, recipient: (params.To ?? "").replace(/^whatsapp:/, ""),
                              timestamp: Math.floor(now() / 1000), errors: params.ErrorCode ? [{ code: Number(params.ErrorCode) }] : undefined });
      } else if (params.MessageSid && deduper.firstTime(params.MessageSid)) {
        const phone = (params.From ?? "").replace(/^whatsapp:\+?/, "");
        const text = Number(params.NumMedia ?? 0) > 0 && !params.Body ? undefined : params.Body;
        track(processInbound(phone, text, now(), params.ProfileName).catch((e) => log("processing error", e)));
      }
      res.writeHead(200, { "Content-Type": "text/xml" });
      return void res.end("<Response></Response>"); // empty TwiML: replies go out via the Messages API
    }

    if (url.pathname.startsWith("/admin/")) {
      if (req.headers.authorization !== `Bearer ${cfg.adminToken}`) return send(401, { error: "unauthorized" });
      if (url.pathname === "/admin/appointments" && req.method === "GET") return send(200, store.appointments);
      if (url.pathname === "/admin/handoffs" && req.method === "GET") return send(200, store.handoffQueue);
      if (url.pathname === "/admin/statuses" && req.method === "GET") return send(200, store.statuses);
      if (url.pathname === "/admin/send" && req.method === "POST") {
        // Staff follow-up: free text inside the 24h window, otherwise an approved template only.
        const { to, text, template } = JSON.parse(raw.toString("utf8") || "{}");
        const s = store.sessions.get(to);
        if (!s) return send(404, { error: "unknown contact" });
        const r = template ? await messenger.template(s, template) : await messenger.text(s, text ?? "");
        return send(r.ok ? 200 : 422, r);
      }
    }
    send(404, { error: "not found" });
  }

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { route(req, res, Buffer.concat(chunks)).catch((e) => { log(e); res.writeHead(500).end(); }); });
  });

  return { server, store, deduper, idle: async () => { while (pending.size) await Promise.all([...pending]); } };
}
