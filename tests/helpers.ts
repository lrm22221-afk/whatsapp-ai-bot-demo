import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { signBody } from "../src/signature.js";
import type { Config } from "../src/config.js";

export interface GraphCall { path: string; auth?: string; body: any }

/** Local stand-in for graph.facebook.com that records every request. */
export async function startMockGraph() {
  const calls: GraphCall[] = [];
  const failures: number[] = []; // queue of HTTP status codes to return before succeeding
  let n = 0;
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      calls.push({ path: req.url ?? "", auth: req.headers.authorization, body: JSON.parse(raw || "{}") });
      const fail = failures.shift();
      res.writeHead(fail ?? 200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(fail ? { error: { message: "mock failure", code: fail } } : { messaging_product: "whatsapp", messages: [{ id: `wamid.out.${++n}` }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url, calls, failures,
    texts: () => calls.filter((c) => c.body.type === "text").map((c) => c.body.text.body as string),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export function testConfig(graphBaseUrl: string): Config {
  return {
    port: 0, verifyToken: "verify-me", appSecret: "test-app-secret", accessToken: "test-access-token",
    phoneNumberId: "1234567890", graphBaseUrl, graphApiVersion: "v21.0", adminToken: "admin-secret",
    approvedTemplates: ["appointment_followup"], faqMinScore: 0.4,
  };
}

let seq = 0;
export function inbound(from: string, text: string, opts: { id?: string; timestamp?: number; name?: string } = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA_ID", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp",
      metadata: { display_phone_number: "15550000000", phone_number_id: "1234567890" },
      contacts: [{ profile: { name: opts.name ?? "Test User" }, wa_id: from }],
      messages: [{ from, id: opts.id ?? `wamid.in.${++seq}`, timestamp: String(Math.floor((opts.timestamp ?? Date.now()) / 1000)), type: "text", text: { body: text } }],
    } }] }],
  };
}

export function statusEvent(id: string, status: string, recipient = "972500000001", errors?: unknown) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "WABA_ID", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { display_phone_number: "15550000000", phone_number_id: "1234567890" },
      statuses: [{ id, status, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: recipient, ...(errors ? { errors } : {}) }],
    } }] }],
  };
}

export function signed(payload: unknown, secret = "test-app-secret") {
  const body = JSON.stringify(payload);
  return { body, headers: { "Content-Type": "application/json", "X-Hub-Signature-256": signBody(body, secret) } };
}
