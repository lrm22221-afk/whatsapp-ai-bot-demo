import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ExtractiveGenerator, HashingEmbedder, OpenAIEmbedder, OpenAIGenerator, Retriever, type KnowledgeBase } from "./rag.js";

export const KB_PATH = fileURLToPath(new URL("../knowledge/clinic.json", import.meta.url));

export function loadKb(path = KB_PATH): KnowledgeBase { return JSON.parse(readFileSync(path, "utf8")); }

/** Offline by default; real models only when their API keys are configured. */
export async function buildRag(env: NodeJS.ProcessEnv = process.env) {
  const embedder = env.EMBEDDINGS_API_KEY ? new OpenAIEmbedder(env.EMBEDDINGS_API_KEY, env.EMBEDDINGS_MODEL, env.LLM_BASE_URL) : new HashingEmbedder();
  const generator = env.LLM_API_KEY ? new OpenAIGenerator(env.LLM_API_KEY, env.LLM_MODEL, env.LLM_BASE_URL) : new ExtractiveGenerator();
  const retriever = new Retriever(loadKb(), embedder);
  await retriever.init();
  return { retriever, generator };
}
