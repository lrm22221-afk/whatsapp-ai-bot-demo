export interface Config {
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
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
    return v;
  };
  return {
    port: Number(env.PORT ?? 3000),
    verifyToken: required("WHATSAPP_VERIFY_TOKEN"),
    appSecret: required("WHATSAPP_APP_SECRET"),
    accessToken: required("WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: required("WHATSAPP_PHONE_NUMBER_ID"),
    graphBaseUrl: (env.GRAPH_BASE_URL ?? "https://graph.facebook.com").replace(/\/+$/, ""),
    graphApiVersion: env.GRAPH_API_VERSION ?? "v21.0",
    adminToken: required("ADMIN_TOKEN"),
    approvedTemplates: (env.APPROVED_TEMPLATES ?? "appointment_followup,hello_world")
      .split(",").map((s) => s.trim()).filter(Boolean),
    faqMinScore: Number(env.FAQ_MIN_SCORE ?? 0.4),
  };
}
