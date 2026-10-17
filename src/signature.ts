import { createHmac, timingSafeEqual } from "node:crypto";

/** Computes the value Meta sends in the X-Hub-Signature-256 header. */
export function signBody(rawBody: Buffer | string, appSecret: string): string {
  return "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
}

/** Constant-time check of X-Hub-Signature-256 against the raw request body. */
export function verifySignature(rawBody: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from(signBody(rawBody, appSecret));
  const received = Buffer.from(header);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(expected, received);
}
