# Importing the n8n workflow

`whatsapp_bot_workflow.json` implements the same flow as the TypeScript service in a simplified form:
**GET verify handshake → POST signature check → fast 200 → dedupe → route → reply via Graph API**.

Routing in n8n is keyword-based (FAQ, STOP/START, human handoff, prompt-injection refusal).
Retrieval scoring, appointment slot-filling and the 24-hour window checks live only in the TypeScript service.

The JSON is generated from `n8n/code/*.js` by `node n8n/build-workflow.mjs`. CI checks that it is in sync and
executes the three Code nodes against signed sample payloads (`tests/n8n-workflow.test.ts`).
It has **not** been run against a live n8n instance or a live Meta app as part of this repo.

## Steps

1. n8n → **Workflows → Import from File** → choose `n8n/whatsapp_bot_workflow.json`.
2. Set these environment variables on the n8n instance (then restart it):
   ```
   NODE_FUNCTION_ALLOW_BUILTIN=crypto
   WHATSAPP_VERIFY_TOKEN=...
   WHATSAPP_APP_SECRET=...
   WHATSAPP_ACCESS_TOKEN=...
   WHATSAPP_PHONE_NUMBER_ID=...
   GRAPH_API_VERSION=v21.0          # optional
   GRAPH_BASE_URL=https://graph.facebook.com   # optional; point at a mock for testing
   ```
   If your instance blocks `$env` in expressions (`N8N_BLOCK_ENV_ACCESS_IN_NODE=true`), use n8n Credentials instead
   (a Header Auth credential for the Graph API token).
3. Keep **Raw Body** enabled on the *Webhook POST (messages)* node: the HMAC must be computed over the exact bytes Meta sent.
4. Activate the workflow and copy the production URL of the webhook (`https://<your-n8n>/webhook/whatsapp`).
5. In the Meta app → **WhatsApp → Configuration → Webhook**: paste that URL and your verify token, click *Verify and save*,
   then subscribe to the **messages** field.
6. Send a message to your WhatsApp test number and watch the execution in n8n.

Note: the dedupe and opt-out lists use workflow static data, which n8n only persists for production (active) executions.
For production use, move them to a database or Redis.
