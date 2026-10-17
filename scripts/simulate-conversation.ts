/**
 * Simulated sender for the Twilio adapter (no real Twilio calls, no secrets).
 * Sends correctly signed fake Twilio webhooks (X-Twilio-Signature) to a local bot instance with
 * PROVIDER=twilio and points the outbound Messages API at a local mock that records every reply.
 * Prints the conversation; with --json <file> also writes it as JSON (used to render the screenshot).
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { writeFileSync } from "node:fs";
import { createApp } from "../src/server.js";
import { buildRag } from "../src/bootstrap.js";
import { twilioSignature } from "../src/twilio.js";
import type { Config } from "../src/config.js";

const SID = "ACsimulated", TOKEN = "simulated-auth-token", PUBLIC = "https://bot.example.com/twilio/webhook";
const BOT = "whatsapp:+14155238886", USER = "whatsapp:+972500000001";

const replies: string[] = [];
const mock = createServer((req, res) => {
  let raw = ""; req.on("data", (c) => (raw += c));
  req.on("end", () => {
    replies.push(new URLSearchParams(raw).get("Body") ?? "");
    res.writeHead(201, { "Content-Type": "application/json" }); res.end(JSON.stringify({ sid: `SMmock${replies.length}`, status: "queued" }));
  });
});
await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));

const cfg: Config = {
  provider: "twilio", port: 0, verifyToken: "", appSecret: "", accessToken: "", phoneNumberId: "", graphBaseUrl: "http://unused",
  graphApiVersion: "v21.0", adminToken: "simulated-admin", approvedTemplates: [], faqMinScore: 0.4,
  twilio: { accountSid: SID, authToken: TOKEN, from: BOT, apiBaseUrl: `http://127.0.0.1:${(mock.address() as AddressInfo).port}`, webhookUrl: PUBLIC },
};
const { retriever, generator } = await buildRag({});
const app = createApp({ cfg, retriever, generator });
await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

const script = [
  "What are your opening hours?",
  "כמה עולה בדיקה?",
  "I'd like to book an appointment",
  "Dana Levi",
  "2026-10-20",
  "10:30",
  "I want a human",
  "Are you still there?",
  "STOP",
];
const transcript: { user: string; status: number; bot: string[] }[] = [];
let i = 0;
for (const Body of script) {
  const params = { MessageSid: `SMsim${++i}`, AccountSid: SID, From: USER, To: BOT, Body, NumMedia: "0", ProfileName: "Dana" };
  const before = replies.length;
  const res = await fetch(`${base}/twilio/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": twilioSignature(PUBLIC, params, TOKEN) },
    body: new URLSearchParams(params).toString(),
  });
  await app.idle();
  const bot = replies.slice(before);
  transcript.push({ user: Body, status: res.status, bot });
  console.log(`\x1b[36m👤 user →\x1b[0m ${Body}   \x1b[2m(webhook ${res.status})\x1b[0m`);
  for (const t of bot) console.log(`\x1b[32m🤖 bot  →\x1b[0m ${t}`);
  if (!bot.length) console.log("\x1b[2m   (no bot reply)\x1b[0m");
  console.log();
}
const bad = await fetch(`${base}/twilio/webhook`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": "invalid" }, body: "Body=hi&From=x" });
console.log(`Bad signature check: webhook ${bad.status}`);
const j = process.argv.indexOf("--json");
if (j > 0) writeFileSync(process.argv[j + 1], JSON.stringify({ transcript, badSignatureStatus: bad.status, appointments: app.store.appointments }, null, 2));
app.server.close(); mock.close();
