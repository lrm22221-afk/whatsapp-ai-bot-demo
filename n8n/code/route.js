// n8n Code node: dedupe by message id, then route each inbound text to a reply.
// Simplified keyword routing (the TypeScript service has the full retrieval + appointment logic).
const store = $getWorkflowStaticData('global');
store.seen = store.seen || {};
store.optedOut = store.optedOut || {};
const now = Date.now();
for (const [id, exp] of Object.entries(store.seen)) if (exp < now) delete store.seen[id];

const isHe = (t) => { const he = (t.match(/[\u05D0-\u05EA]/g) || []).length; const en = (t.match(/[A-Za-z]/g) || []).length; return (he || en) ? he * 2 >= en : true; };
const L = (he, en, h) => (h ? he : en);
const KB = [
  { keys: ['hour', 'open', 'close', 'שעות', 'פתוחים', 'פתיחה'], he: 'אנחנו פתוחים בימים א׳–ה׳ 08:00–19:00 וביום ו׳ 08:00–13:00. בשבת המרפאה סגורה.', en: 'We are open Sunday–Thursday 08:00–19:00 and Friday 08:00–13:00. We are closed on Saturday.' },
  { keys: ['address', 'where', 'parking', 'כתובת', 'איפה', 'חניה'], he: 'אנחנו ברחוב השלום 12, קומה 2 (כתובת לדוגמה). יש חניה בתשלום בבניין.', en: 'We are at 12 HaShalom Street, 2nd floor (demo address). There is paid parking in the building.' },
  { keys: ['checkup', 'check-up', 'cleaning', 'בדיקה', 'ניקוי', 'אבנית'], he: 'בדיקה עולה 250 ש"ח, ובדיקה עם ניקוי אבנית 400 ש"ח (מחירים לדוגמה).', en: 'A check-up costs 250 ILS and a check-up with cleaning costs 400 ILS (demo prices).' },
];
const INJECTION = /ignore (all |any )?(the )?(previous|prior|above) (instructions|rules)|system prompt|you are now|developer mode|jailbreak|התעלם\S* מ|הוראות הקודמות/i;

const out = [];
const body = $input.first().json.body || {};
for (const entry of body.entry || []) for (const change of entry.changes || []) {
  const value = change.value || {};
  for (const msg of value.messages || []) {
    if (store.seen[msg.id]) continue;            // webhook retry: already handled
    store.seen[msg.id] = now + 24 * 3600 * 1000;
    const from = msg.from;
    const text = msg.type === 'text' ? String(msg.text.body || '') : '';
    const he = isHe(text);
    let reply;
    if (/^\s*(stop|unsubscribe|הסר|הסרה)\s*$/i.test(text)) { store.optedOut[from] = true; reply = L('הוסרת. להצטרפות מחדש השיבו START.', 'You have been unsubscribed. Reply START to subscribe again.', he); }
    else if (store.optedOut[from] && !/^\s*start\s*$/i.test(text)) continue;
    else if (/^\s*start\s*$/i.test(text)) { delete store.optedOut[from]; reply = L('נרשמת מחדש.', 'You are subscribed again.', he); }
    else if (!text) reply = L('אני יכול לקרוא רק הודעות טקסט.', 'I can only read text messages.', he);
    else if (INJECTION.test(text)) reply = L('מצטער, אין באפשרותי לעשות זאת.', "Sorry, I can't do that.", he);
    else if (/\b(human|agent|representative)\b|נציג/i.test(text)) reply = L('מעביר אותך לנציג מהצוות.', "I'm passing you to a member of our team.", he);
    else {
      const t = text.toLowerCase();
      const hit = KB.find((k) => k.keys.some((w) => t.includes(w)));
      reply = hit ? L(hit.he, hit.en, he) : L('אין לי מידע מאומת על כך. העברתי לצוות.', "I don't have verified information about that. I've passed it to our team.", he);
    }
    out.push({ json: { to: from, message_id: msg.id, reply } });
  }
}
return out;
