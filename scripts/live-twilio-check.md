# Live Twilio check (WhatsApp)

## Status

| Check | Result |
|---|---|
| Signed Twilio-style POST to the public `/twilio/webhook` URL | **200**, empty TwiML, bot logic ran |
| Same request with an invalid `X-Twilio-Signature` | **403** |
| Outbound call to the real Twilio Messages API | Credentials accepted; send to an unverified test number rejected with **422** (trial restriction) |
| Real phone round-trip (WhatsApp in → bot reply out) | **Not run** |

Why the round-trip was not run: the account is a Twilio **trial**. Trial accounts cannot set the inbound webhook for the
WhatsApp sender (Senders API `/v2/Channels/Senders` returns 401 "not available on a Trial account"; the Sandbox settings
page requires an upgrade) and can only send to verified recipients (422 otherwise). No upgrade or purchase was made.

For a fully local demonstration, run `npm run simulate` (signed fake webhooks + mock Messages API, no real Twilio calls).

## Steps on an account where Sandbox settings are available

1. Run the bot with `PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM=whatsapp:<sandbox or sender number>`,
   `ADMIN_TOKEN`, and `TWILIO_WEBHOOK_URL=https://<public host>/twilio/webhook` (must match the Console URL exactly, or signatures fail with 403).
2. Expose port 3000 over HTTPS (for example `ngrok http 3000`).
3. Twilio Console → Messaging → Try it out → Send a WhatsApp message → Sandbox settings: set "When a message comes in" to
   `https://<public host>/twilio/webhook`, method POST, and save.
4. From your phone, send the `join <code>` message shown in the Console to the sandbox number.

## Manual checks

1. "What are your opening hours?" → "We are open Sunday–Thursday 08:00–19:00 and Friday 08:00–13:00. We are closed on Saturday."
2. "כמה עולה בדיקה?" → "בדיקה עולה 250 ש"ח, ובדיקה עם ניקוי אבנית 400 ש"ח (מחירים לדוגמה)."
3. "I'd like to book an appointment" → asks name, date, time, then confirms the request; it appears in `GET /admin/appointments`.
4. "I want a human" → handoff message, then the bot stays silent; it appears in `GET /admin/handoffs`.
5. "STOP" → unsubscribe confirmation (processed even during handoff).
6. Delivery statuses appear in `GET /admin/statuses` (if a status callback is configured).
