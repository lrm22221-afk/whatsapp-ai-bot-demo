// n8n Code node: verify X-Hub-Signature-256 over the RAW body (Webhook option "Raw Body" must be on).
// Requires NODE_FUNCTION_ALLOW_BUILTIN=crypto on the n8n instance.
const crypto = require('crypto');
const item = $input.first();
const headers = item.json.headers || {};
const raw = await this.helpers.getBinaryDataBuffer(0, 'data');
const expected = 'sha256=' + crypto.createHmac('sha256', $env.WHATSAPP_APP_SECRET).update(raw).digest('hex');
const received = String(headers['x-hub-signature-256'] || '');
const valid = received.length === expected.length &&
  crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
let body = {};
if (valid) { try { body = JSON.parse(raw.toString('utf8')); } catch (e) { return [{ json: { valid: false, status: 400 } }]; } }
return [{ json: { valid, status: valid ? 200 : 401, body } }];
