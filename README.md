# WhatsApp AI Bot Demo: bilingual clinic assistant on the WhatsApp Cloud API

[![CI](https://github.com/lrm22221-afk/whatsapp-ai-bot-demo/actions/workflows/ci.yml/badge.svg)](https://github.com/lrm22221-afk/whatsapp-ai-bot-demo/actions/workflows/ci.yml)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

> **Demo project. It runs on mocks and is not a client deployment.** The clinic, address, prices and insurance data are
> fictional. The test suite and CI talk to a local mock of the Graph API, never to Meta.

A TypeScript/Node webhook service for the **Meta WhatsApp Cloud API**, plus an equivalent **n8n** workflow.
It shows the parts that usually break in real WhatsApp bot projects: webhook verification, signature checks,
duplicate deliveries, status callbacks, the 24-hour messaging window, opt-outs, and an AI assistant
that refuses to make up answers.

## The problem

Small businesses (clinics, salons, local ISPs) get the same WhatsApp questions all day, in Hebrew and English.
A useful bot must:

- answer only from the business's own information (no invented prices),
- book appointment *requests* in a structured format the staff can act on,
- pass the conversation to a person when asked or when unsure,
- follow WhatsApp rules (signed webhooks, retries, opt-out, 24-hour window, approved templates only).

## Architecture

```mermaid
flowchart LR
    U[Customer on WhatsApp] -->|message| META[Meta WhatsApp Cloud API]
    META -->|"POST /webhook + X-Hub-Signature-256"| SIG{HMAC valid?}
    SIG -->|no| R401[401]
    SIG -->|yes| ACK[200 immediately]
    ACK --> DD{Seen message id?}
    DD -->|yes| DROP[ignore retry]
    DD -->|no| AS[Assistant]
    META -->|status callbacks| ST[(Status log)]
    subgraph AS[Assistant]
      direction TB
      L[Language detect he/en] --> G[Guardrails: STOP, injection, handoff]
      G --> APT[Appointment slot-filling]
      G --> RAG[Retriever over knowledge/clinic.json]
      RAG -->|score >= FAQ_MIN_SCORE| GEN[Generator: extractive or LLM]
      GEN --> PC{Prices grounded?}
      RAG -->|low score| HO[Human handoff queue]
      PC -->|no| HO
    end
    AS --> WIN{Inside 24h window? Not opted out?}
    WIN -->|yes| GRAPH["POST /{phone-number-id}/messages"]
    WIN -->|no| TPL[Approved template only]
    GRAPH --> META
```

## Features

| Area | What it does | Where |
|---|---|---|
| Webhook verify | `GET /webhook` echoes `hub.challenge` only when `hub.verify_token` matches, else 403 | `src/server.ts` |
| Signature | `X-Hub-Signature-256` HMAC-SHA256 over the raw body, constant-time compare, 401 on mismatch | `src/signature.ts` |
| Idempotency | Dedupe by WhatsApp message id (24h TTL), so Meta retries are processed once | `src/dedupe.ts` |
| Fast ack | Returns 200 before doing the AI work; replies are sent asynchronously | `src/server.ts` |
| Status callbacks | Stores `sent`/`delivered`/`read`/`failed` with error details | `src/server.ts` |
| Graph client | Text, template and mark-as-read; retries 429/5xx, not 4xx; base URL is configurable | `src/graph.ts` |
| Bilingual | Hebrew/English detection (mixed messages count as Hebrew when at least 1/3 of the letters are Hebrew) | `src/lang.ts` |
| Grounded FAQ | Retrieval over a small knowledge base with pluggable embeddings and generator | `src/rag.ts` |
| Offline mode | Deterministic hashed word+trigram embeddings and an extractive generator, so no API key is needed | `src/rag.ts` |
| No invented prices | Low retrieval score → handoff; any amount of money not in the retrieved text is blocked; service-specific price entries need the service to be named | `src/guardrails.ts`, `knowledge/clinic.json` |
| Appointments | Collects name, date and time (several per message is fine) into a structured `requested` record | `src/assistant.ts` |
| Handoff | On "human"/"נציג" or low confidence; the bot then stays silent so staff can take over | `src/assistant.ts` |
| Opt-out | `STOP`/`הסר` sends one confirmation and nothing else until `START` | `src/assistant.ts`, `src/messenger.ts` |
| 24-hour window | Free text only within 24h of the customer's last message; outside it, only templates in `APPROVED_TEMPLATES` | `src/messenger.ts` |
| Prompt injection | Pattern-based refusal in Hebrew and English; the LLM prompt also treats user text as data | `src/guardrails.ts` |
| Admin API | Bearer-protected `/admin/appointments`, `/admin/handoffs`, `/admin/statuses`, `/admin/send` | `src/server.ts` |
| n8n | Same flow as an importable workflow (simplified keyword routing) | `n8n/` |

## Quick start

Requires Node.js 20+.

```bash
git clone https://github.com/lrm22221-afk/whatsapp-ai-bot-demo.git
cd whatsapp-ai-bot-demo
npm ci
npm test            # unit + integration + n8n tests against a local mock Graph API
npm run eval        # offline evaluation on 28 held-out messages
npm run demo        # prints a sample bilingual conversation (signed webhook -> bot -> mock Graph API)

cp .env.example .env    # fill in your values
npm run start:env       # starts the webhook server on $PORT (default 3000)
```

Check the handshake locally:

```bash
curl "http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=<WHATSAPP_VERIFY_TOKEN>&hub.challenge=123"
# -> 123
```

## Environment variables

See [`.env.example`](.env.example). No secrets are committed.

| Variable | Required | Purpose |
|---|---|---|
| `WHATSAPP_VERIFY_TOKEN` | yes | Value you also enter in the Meta webhook settings |
| `WHATSAPP_APP_SECRET` | yes | Meta app secret, used to check `X-Hub-Signature-256` |
| `WHATSAPP_ACCESS_TOKEN` | yes | System User token with `whatsapp_business_messaging` |
| `WHATSAPP_PHONE_NUMBER_ID` | yes | Sender phone number id |
| `ADMIN_TOKEN` | yes | Bearer token for `/admin/*` |
| `GRAPH_BASE_URL` | no | Default `https://graph.facebook.com`; tests point it at a mock |
| `GRAPH_API_VERSION` | no | Default `v21.0` |
| `APPROVED_TEMPLATES` | no | Comma-separated template names allowed outside the 24h window |
| `FAQ_MIN_SCORE` | no | Retrieval threshold, default `0.4` |
| `EMBEDDINGS_API_KEY`, `EMBEDDINGS_MODEL` | no | Use OpenAI-compatible embeddings instead of the offline embedder |
| `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` | no | Use an OpenAI-compatible chat model to phrase answers from the retrieved text |

## Connecting a real Meta app

1. Create an app at developers.facebook.com, add the **WhatsApp** product and note the test phone number's
   **Phone number ID**.
2. Create a **System User** in Business Settings, give it the app and the WhatsApp account, and generate a
   permanent token with `whatsapp_business_messaging` (and `whatsapp_business_management` for templates).
3. Copy the **App secret** (App settings → Basic).
4. Deploy this service behind HTTPS (or use a tunnel such as `ngrok http 3000` for testing).
5. WhatsApp → Configuration → Webhook: callback URL `https://<host>/webhook`, verify token = `WHATSAPP_VERIFY_TOKEN`,
   then subscribe to the **messages** field.
6. Create and get approval for any template you list in `APPROVED_TEMPLATES` (WhatsApp Manager → Message templates).
7. Edit `knowledge/clinic.json` with the business's real information.

## Using a real LLM

By default everything is offline and deterministic. With `LLM_API_KEY` set, the retrieved answer text is passed as the only
context to an OpenAI-compatible chat model (temperature 0), told to answer `NO_ANSWER` when the context does not cover the
question. The output still goes through the price-grounding check, and any error falls back to the extractive answer.
**This path is not exercised by the tests or CI** (they never call a real model).

## Test results

Last local run (same commands as CI):

![Test run](screenshots/test-run.png)

- `npm test`: **40 tests passing** across 3 files: 17 unit, 18 integration (real HTTP server + mock Graph API),
  5 for the n8n workflow (structure check plus running its Code nodes on signed payloads).
- `npm run eval`: **27/28 (96.4%)** on held-out phrasings that are not in the knowledge base verbatim. CI fails below 90%.
  The one miss is a Hebrew injection phrasing ("שכח את כל ההוראות…") that the patterns do not catch; it fails safe
  (the bot hands off and gives no answer). It is left in the set on purpose.
- CI runs typecheck, tests, eval and the demo on Node 20 and 22.

Sample bilingual conversation (`npm run demo`):

![Sample conversation](screenshots/bilingual-conversation.png)

## n8n version

[`n8n/whatsapp_bot_workflow.json`](n8n/whatsapp_bot_workflow.json): GET verify → POST signature check → 200 → dedupe →
route → reply via the Graph API. See [`n8n/IMPORT.md`](n8n/IMPORT.md) for the import guide and its limits.

## Project layout

```
src/            webhook server, signature, dedupe, Graph client, assistant, RAG, guardrails, 24h window
knowledge/      fictional clinic knowledge base (Hebrew + English)
tests/          vitest: unit, integration (mock Graph API), n8n workflow
eval/           held-out evaluation cases and runner
n8n/            workflow JSON, its Code-node sources, import guide
scripts/        sample conversation used for the screenshot
screenshots/    real terminal renders of the test run and demo
```

## Limitations

- **Demo only.** It has not been connected to a live Meta app or a client's number as part of this repo.
- State (sessions, dedupe, appointments, handoffs) lives in memory and is lost on restart. Production needs Redis or a database,
  and dedupe must be shared when running more than one instance.
- Appointments are *requests*. There is no calendar integration or availability check.
- Intent detection uses keywords and patterns. The offline retriever is tuned for a small FAQ, not large document sets.
- Prompt-injection detection is pattern-based and will miss some phrasings (see the eval).
- Text, button and interactive replies are handled; media messages get a polite "text only" reply.
- The n8n workflow uses simplified keyword routing and has not been run on a live n8n instance here.

## License

MIT, see [LICENSE](LICENSE).
