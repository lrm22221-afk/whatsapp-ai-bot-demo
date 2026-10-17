import { loadConfig } from "./config.js";
import { createApp } from "./server.js";
import { buildRag } from "./bootstrap.js";

const cfg = loadConfig();
const { retriever, generator } = await buildRag();
const app = createApp({ cfg, retriever, generator, log: (...a) => console.log(new Date().toISOString(), ...a) });
app.server.listen(cfg.port, () => console.log(`WhatsApp bot demo listening on :${cfg.port} (Graph API: ${cfg.graphBaseUrl})`));
