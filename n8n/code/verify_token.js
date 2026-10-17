// n8n Code node: Meta webhook verification handshake (GET).
const q = $input.first().json.query || {};
const ok = q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === $env.WHATSAPP_VERIFY_TOKEN;
return [{ json: { ok, challenge: ok ? String(q['hub.challenge'] ?? '') : 'Forbidden' } }];
