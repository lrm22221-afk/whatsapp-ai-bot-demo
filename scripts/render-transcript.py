"""Render the JSON written by `npm run simulate -- --json sim.json` into a chat-style HTML page.
Usage: python3 scripts/render-transcript.py sim.json sim.html
Then screenshot it, e.g.: google-chrome --headless=new --window-size=720,1500 --screenshot=out.png file://$PWD/sim.html"""
import html, json, sys
d = json.load(open(sys.argv[1]))
def b(t, cls):
    rtl = ' dir="rtl"' if any('\u0590' <= c <= '\u05ff' for c in t) else ''
    return f'<div class="m {cls}"{rtl}>{html.escape(t)}</div>'
rows = []
for x in d['transcript']:
    rows.append(b(x['user'], 'u') + f'<div class="meta r">webhook {x["status"]}</div>')
    rows += [b(t, 'b') for t in x['bot']] or ['<div class="meta">(no bot reply: conversation is in human handoff)</div>']
open(sys.argv[2], 'w').write(f'''<html><head><meta charset="utf-8"><style>
body{{margin:0;font-family:'Segoe UI',Arial,'Noto Sans Hebrew',sans-serif;background:#efeae2;width:720px}}
.h{{background:#075e54;color:#fff;padding:14px 18px;font-size:17px}}.h small{{display:block;opacity:.8;font-size:12px}}
.c{{padding:14px 18px;display:flex;flex-direction:column}}
.m{{max-width:72%;padding:8px 11px;border-radius:8px;margin:4px 0;font-size:14.5px;line-height:1.35;box-shadow:0 1px .5px rgba(0,0,0,.15)}}
.u{{align-self:flex-end;background:#d9fdd3}}.b{{align-self:flex-start;background:#fff}}
.meta{{font-size:11px;color:#667;margin:0 4px 4px}}.r{{align-self:flex-end}}
.f{{font-size:12px;color:#445;padding:10px 18px 16px;border-top:1px solid #d6cfc4}}</style></head><body>
<div class="h">Clinic assistant (demo) <small>Simulated sender · signed Twilio webhooks · mock Messages API · real bot output from scripts/simulate-conversation.ts</small></div>
<div class="c">{"".join(rows)}</div>
<div class="f">Bad-signature request → HTTP {d["badSignatureStatus"]}. No real Twilio/WhatsApp messages were sent.</div></body></html>''')
