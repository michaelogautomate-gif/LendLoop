const encoder = new TextEncoder();

export const MAX_TIMESTAMP_SKEW_SECONDS = 300; // +/- 5 minutes
export const MIN_HMAC_SECRET_LENGTH = 16;

export async function computeHmacSha256Hex(
  secret: string,
  payload: string
): Promise<string> {
  if (!secret || secret.length < MIN_HMAC_SECRET_LENGTH) {
    throw new Error("HMAC secret is missing or too short (min 16 chars)");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload)
  );
  return Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function buildSignedHeaders(
  secret: string,
  rawBody: string,
  eventId: string,
  nowEpochSeconds = Math.floor(Date.now() / 1000)
): Promise<Record<string, string>> {
  const canonical = `${nowEpochSeconds}.${rawBody}`;
  const hex = await computeHmacSha256Hex(secret, canonical);
  return {
    "Content-Type": "application/json",
    "X-LendLoop-Timestamp": String(nowEpochSeconds),
    "X-LendLoop-Event-Id": eventId,
    "X-LendLoop-Signature": `sha256=${hex}`,
  };
}

/**
 * Constant-time UTF-8 byte comparison across the full length of both strings.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  const maxLen = Math.max(bufA.length, bufB.length);
  let diff = bufA.length ^ bufB.length;
  for (let i = 0; i < maxLen; i += 1) {
    const byteA = i < bufA.length ? bufA[i] : 0;
    const byteB = i < bufB.length ? bufB[i] : 0;
    diff |= byteA ^ byteB;
  }
  return diff === 0;
}

export async function verifySignedRequest(params: {
  secret: string;
  rawBody: string;
  timestampHeader: string | null | undefined;
  signatureHeader: string | null | undefined;
  nowEpochSeconds?: number;
}): Promise<{ ok: boolean; reason?: string }> {
  const {
    secret,
    rawBody,
    timestampHeader,
    signatureHeader,
    nowEpochSeconds = Math.floor(Date.now() / 1000),
  } = params;

  if (!secret || secret.length < MIN_HMAC_SECRET_LENGTH) {
    return {
      ok: false,
      reason: "HMAC secret is missing or too short (min 16 chars)",
    };
  }

  if (!timestampHeader || !signatureHeader) {
    return { ok: false, reason: "Missing signature or timestamp header" };
  }

  const trimmedTs = timestampHeader.trim();
  if (!/^\d+$/.test(trimmedTs)) {
    return { ok: false, reason: "Malformed timestamp header" };
  }

  const ts = Number(trimmedTs);
  if (!Number.isSafeInteger(ts) || ts <= 0) {
    return { ok: false, reason: "Malformed timestamp header" };
  }

  if (Math.abs(nowEpochSeconds - ts) > MAX_TIMESTAMP_SKEW_SECONDS) {
    return { ok: false, reason: "Timestamp outside allowed 300s replay window" };
  }

  const normalizedSig = signatureHeader.trim().startsWith("sha256=")
    ? signatureHeader.trim().slice(7)
    : signatureHeader.trim();

  if (!/^[0-9a-f]{64}$/i.test(normalizedSig)) {
    return { ok: false, reason: "Malformed HMAC signature format" };
  }

  const expectedHex = await computeHmacSha256Hex(secret, `${ts}.${rawBody}`);

  if (
    !constantTimeEqual(normalizedSig.toLowerCase(), expectedHex.toLowerCase())
  ) {
    return { ok: false, reason: "HMAC signature mismatch" };
  }

  return { ok: true };
}

