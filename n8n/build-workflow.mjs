// Builds n8n/whatsapp_bot_workflow.json from the Code-node sources in n8n/code (single source of truth, tested in CI).
import { readFileSync, writeFileSync } from "node:fs";
const code = (f) => readFileSync(new URL(`./code/${f}`, import.meta.url), "utf8");
const node = (id, name, type, typeVersion, position, parameters) => ({ id, name, type, typeVersion, position, parameters });
const wf = {
  name: "WhatsApp Cloud API bot (demo)",
  nodes: [
    node("1", "Webhook GET (verify)", "n8n-nodes-base.webhook", 2, [0, 0], { httpMethod: "GET", path: "whatsapp", responseMode: "responseNode", options: {} }),
    node("2", "Check verify token", "n8n-nodes-base.code", 2, [220, 0], { jsCode: code("verify_token.js") }),
    node("3", "Respond challenge", "n8n-nodes-base.respondToWebhook", 1.1, [440, 0], { respondWith: "text", responseBody: "={{ $json.challenge }}", options: { responseCode: "={{ $json.ok ? 200 : 403 }}" } }),
    node("4", "Webhook POST (messages)", "n8n-nodes-base.webhook", 2, [0, 240], { httpMethod: "POST", path: "whatsapp", responseMode: "responseNode", options: { rawBody: true } }),
    node("5", "Verify signature", "n8n-nodes-base.code", 2, [220, 240], { jsCode: code("verify_signature.js") }),
    node("6", "Acknowledge", "n8n-nodes-base.respondToWebhook", 1.1, [440, 240], { respondWith: "noData", options: { responseCode: "={{ $json.status }}" } }),
    node("7", "Signature valid?", "n8n-nodes-base.if", 2, [660, 240], {
      conditions: { options: { caseSensitive: true, typeValidation: "strict" }, combinator: "and",
        conditions: [{ id: "c1", leftValue: "={{ $json.valid }}", rightValue: true, operator: { type: "boolean", operation: "true", singleValue: true } }] },
      options: {} }),
    node("8", "Dedupe & route", "n8n-nodes-base.code", 2, [880, 220], { jsCode: code("route.js") }),
    node("9", "Send reply (Graph API)", "n8n-nodes-base.httpRequest", 4.2, [1100, 220], {
      method: "POST",
      url: "={{ ($env.GRAPH_BASE_URL || 'https://graph.facebook.com') + '/' + ($env.GRAPH_API_VERSION || 'v21.0') + '/' + $env.WHATSAPP_PHONE_NUMBER_ID + '/messages' }}",
      sendHeaders: true,
      headerParameters: { parameters: [{ name: "Authorization", value: "=Bearer {{ $env.WHATSAPP_ACCESS_TOKEN }}" }] },
      sendBody: true, specifyBody: "json",
      jsonBody: "={{ JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: $json.to, type: 'text', text: { body: $json.reply, preview_url: false } }) }}",
      options: { retry: { maxTries: 3 } } }),
  ],
  connections: {
    "Webhook GET (verify)": { main: [[{ node: "Check verify token", type: "main", index: 0 }]] },
    "Check verify token": { main: [[{ node: "Respond challenge", type: "main", index: 0 }]] },
    "Webhook POST (messages)": { main: [[{ node: "Verify signature", type: "main", index: 0 }]] },
    "Verify signature": { main: [[{ node: "Acknowledge", type: "main", index: 0 }]] },
    "Acknowledge": { main: [[{ node: "Signature valid?", type: "main", index: 0 }]] },
    "Signature valid?": { main: [[{ node: "Dedupe & route", type: "main", index: 0 }], []] },
    "Dedupe & route": { main: [[{ node: "Send reply (Graph API)", type: "main", index: 0 }]] },
  },
  settings: { executionOrder: "v1" },
  pinData: {},
};
writeFileSync(new URL("./whatsapp_bot_workflow.json", import.meta.url), JSON.stringify(wf, null, 2) + "\n");
console.log("wrote n8n/whatsapp_bot_workflow.json");
