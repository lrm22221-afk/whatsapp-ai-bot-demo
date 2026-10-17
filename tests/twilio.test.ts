import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { twilioSignature, verifyTwilioSignature, TwilioClient } from "../src/twilio.js";
import { loadConfig, type Config } from "../src/config.js";
import { createApp, type App } from "../src/server.js";
import { buildRag } from "../src/bootstrap.js";

describe("X-Twilio-Signature", () => {
  it("matches the worked example in Twilio's security docs", () => {
    const params = { CallSid: "CA1234567890ABCDE", Caller: "+14158675310", Digits: "1234", From: "+14158675310", To: "+18005551212" };
    expect(twilioSignature("https://example.com/myapp.php?foo=1&bar=2", params, "12345")).toBe("L/OH5YylLD5NRKLltdqwSvS0BnU=");
  });
  it("rejects a wrong token, a changed param, a different URL or a missing header", () => {
    const url = "https://bot.example.com/twilio/webhook", p = { Body: "hi", From: "whatsapp:+972500000001" };
    const sig = twilioSignature(url, p, "tok");
    expect(verifyTwilioSignature(url, p, sig, "tok")).toBe(true);
    expect(verifyTwilioSignature(url, p, sig, "other")).toBe(false);
    expect(verifyTwilioSignature(url, { ...p, Body: "hi!" }, sig, "tok")).toBe(false);
    expect(verifyTwilioSignature("http://bot.example.com/twilio/webhook", p, sig, "tok")).toBe(false);
    expect(verifyTwilioSignature(url, p, undefined, "tok")).toBe(false);
  });
  it("formats WhatsApp addresses", () => {
    expect(TwilioClient.wa("972500000001")).toBe("whatsapp:+972500000001");
    expect(TwilioClient.wa("+14155238886")).toBe("whatsapp:+14155238886");
    expect(TwilioClient.wa("whatsapp:+1")).toBe("whatsapp:+1");
  });
});

describe("PROVIDER config", () => {
  const twilioEnv = { PROVIDER: "twilio", ADMIN_TOKEN: "a", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_WHATSAPP_FROM: "+14155238886" };
  it("twilio mode does not require Meta credentials", () => {
    expect(loadConfig(twilioEnv)).toMatchObject({ provider: "twilio", twilio: { accountSid: "AC1", apiBaseUrl: "https://api.twilio.com" } });
  });
  it("fails clearly on missing Twilio vars or an unknown provider", () => {
    expect(() => loadConfig({ ...twilioEnv, TWILIO_AUTH_TOKEN: "" })).toThrow(/TWILIO_AUTH_TOKEN/);
    expect(() => loadConfig({ PROVIDER: "sms" })).toThrow(/PROVIDER/);
  });
});

describe("Twilio adapter end-to-end (mock Messages API)", () => {
  const calls: { path: string; auth?: string; form: Record<string, string> }[] = [];
  let mock: Server, mockUrl: string, app: App, base: string;
  const PUBLIC = "https://bot.example.com/twilio/webhook";
  const USER = "whatsapp:+972500000001";
  let n = 0;

  beforeAll(async () => {
    mock = createServer((req, res) => {
      let raw = ""; req.on("data", (c) => (raw += c));
      req.on("end", () => {
        calls.push({ path: req.url ?? "", auth: req.headers.authorization, form: Object.fromEntries(new URLSearchParams(raw)) });
        res.writeHead(201, { "Content-Type": "application/json" }); res.end(JSON.stringify({ sid: `SM${++n}`, status: "queued" }));
      });
    });
    await new Promise<void>((r) => mock.listen(0, "127.0.0.1", r));
    mockUrl = `http://127.0.0.1:${(mock.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => mock.close(() => r())));
  beforeEach(async () => {
    calls.length = 0;
    const cfg: Config = {
      provider: "twilio", port: 0, verifyToken: "", appSecret: "", accessToken: "", phoneNumberId: "", graphBaseUrl: "http://unused",
      graphApiVersion: "v21.0", adminToken: "admin-secret", approvedTemplates: ["HXapproved"], faqMinScore: 0.4,
      twilio: { accountSid: "ACtest", authToken: "twilio-token", from: "+14155238886", apiBaseUrl: mockUrl, webhookUrl: PUBLIC },
    };
    const { retriever, generator } = await buildRag({});
    app = createApp({ cfg, retriever, generator });
    await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });
  afterEach(() => new Promise<void>((r) => app.server.close(() => r())));

  async function inbound(params: Record<string, string>, token = "twilio-token") {
    const res = await fetch(`${base}/twilio/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": twilioSignature(PUBLIC, params, token) },
      body: new URLSearchParams(params).toString(),
    });
    await app.idle();
    return res;
  }
  const say = (Body: string, sid = `SMin${Math.random()}`) =>
    inbound({ MessageSid: sid, AccountSid: "ACtest", From: USER, To: "whatsapp:+14155238886", Body, NumMedia: "0", ProfileName: "Dana" });
  const last = () => calls.at(-1)?.form.Body;

  it("answers a question via the Messages API with Basic auth and whatsapp: addresses", async () => {
    const res = await say("What are your opening hours?");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/xml");
    expect(await res.text()).toBe("<Response></Response>");
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/2010-04-01/Accounts/ACtest/Messages.json");
    expect(calls[0].auth).toBe("Basic " + Buffer.from("ACtest:twilio-token").toString("base64"));
    expect(calls[0].form).toMatchObject({ From: "whatsapp:+14155238886", To: USER });
    expect(last()).toContain("Sunday–Thursday 08:00–19:00");
  });

  it("rejects a bad signature with 403 and sends nothing", async () => {
    const res = await inbound({ MessageSid: "SMx", From: USER, Body: "hi" }, "wrong-token");
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("dedupes Twilio retries by MessageSid", async () => {
    await say("Is there parking?", "SMdup");
    await say("Is there parking?", "SMdup");
    expect(calls).toHaveLength(1);
  });

  it("hands off in Hebrew, then honours STOP", async () => {
    await say("אני רוצה לדבר עם נציג");
    expect(last()).toContain("מעביר אותך לנציג");
    await say("STOP");
    expect(last()).toContain("unsubscribed");
    const before = calls.length;
    await say("What are your opening hours?");
    expect(calls.length).toBe(before);
  });

  it("records status callbacks without replying", async () => {
    const res = await inbound({ MessageSid: "SM1", MessageStatus: "undelivered", To: USER, ErrorCode: "63016" });
    expect(res.status).toBe(200);
    const statuses = await (await fetch(`${base}/admin/statuses`, { headers: { Authorization: "Bearer admin-secret" } })).json();
    expect(statuses[0]).toMatchObject({ messageId: "SM1", status: "undelivered", recipient: "+972500000001", errors: [{ code: 63016 }] });
    expect(calls).toHaveLength(0);
  });

  it("outside the 24h window only sends approved Content templates (ContentSid)", async () => {
    await say("Hello");
    const sess = app.store.sessions.get("972500000001")!;
    sess.lastInboundAt -= 25 * 3600 * 1000;
    const post = (b: unknown) => fetch(`${base}/admin/send`, { method: "POST", headers: { Authorization: "Bearer admin-secret" }, body: JSON.stringify(b) });
    expect((await post({ to: "972500000001", text: "hi" })).status).toBe(422);
    expect((await post({ to: "972500000001", template: "HXapproved" })).status).toBe(200);
    expect(calls.at(-1)!.form).toMatchObject({ ContentSid: "HXapproved", To: USER });
  });
});
