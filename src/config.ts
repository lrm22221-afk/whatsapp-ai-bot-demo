export type Provider = "meta" | "twilio";

export interface Config {
  provider: Provider;
  port: number;
  verifyToken: string;
  appSecret: string;
  accessToken: string;
  phoneNumberId: string;
  graphBaseUrl: string;
  graphApiVersion: string;
  adminToken: string;
  approvedTemplates: string[];
  faqMinScore: number;
  twilio?: { accountSid: string; authToken: string; from: string; apiBaseUrl: string; webhookUrl?: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
    return v;
  };
  const provider = (env.PROVIDER ?? "meta").toLowerCase();
  if (provider !== "meta" && provider !== "twilio") throw new Error(`PROVIDER must be "meta" or "twilio", got "${provider}"`);
  const meta = provider === "meta";
  return {
    provider,
    port: Number(env.PORT ?? 3000),
    // Meta credentials are only required when PROVIDER=meta.
    verifyToken: meta ? required("WHATSAPP_VERIFY_TOKEN") : env.WHATSAPP_VERIFY_TOKEN ?? "",
    appSecret: meta ? required("WHATSAPP_APP_SECRET") : env.WHATSAPP_APP_SECRET ?? "",
    accessToken: meta ? required("WHATSAPP_ACCESS_TOKEN") : env.WHATSAPP_ACCESS_TOKEN ?? "",
    phoneNumberId: meta ? required("WHATSAPP_PHONE_NUMBER_ID") : env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    graphBaseUrl: (env.GRAPH_BASE_URL ?? "https://graph.facebook.com").replace(/\/+$/, ""),
    graphApiVersion: env.GRAPH_API_VERSION ?? "v21.0",
    adminToken: required("ADMIN_TOKEN"),
    approvedTemplates: (env.APPROVED_TEMPLATES ?? "appointment_followup,hello_world")
      .split(",").map((s) => s.trim()).filter(Boolean),
    faqMinScore: Number(env.FAQ_MIN_SCORE ?? 0.4),
    twilio: meta ? undefined : {
      accountSid: required("TWILIO_ACCOUNT_SID"),
      authToken: required("TWILIO_AUTH_TOKEN"),
      from: required("TWILIO_WHATSAPP_FROM"),
      apiBaseUrl: (env.TWILIO_API_BASE_URL ?? "https://api.twilio.com").replace(/\/+$/, ""),
      webhookUrl: env.TWILIO_WEBHOOK_URL || undefined,
    },
  };
}
