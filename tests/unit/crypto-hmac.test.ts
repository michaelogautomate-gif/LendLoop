import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildSignedHeaders,
  computeHmacSha256Hex,
  constantTimeEqual,
  verifySignedRequest,
} from "../../convex/lib/crypto";

describe("Phase 1: Cryptographic HMAC & Replay Protection", () => {
  const secret = "lendloop-test-secret-key-2026";
  const rawBody = '{"loanId":"j57abc123"}';
  const baseTimestamp = 1762880000;
  const knownVectorHex = [
    "d4d08ef324607e5c519fec87190b0da2",
    "0c53e8f891822c9ac1810bccfd3cb46b",
  ].join("");

  it("1. generates deterministic HMAC-SHA256 hex matching Node OpenSSL vector", async () => {
    const canonical = `${baseTimestamp}.${rawBody}`;
    const hex = await computeHmacSha256Hex(secret, canonical);
    const nodeRef = createHmac("sha256", secret).update(canonical).digest("hex");
    expect(hex).toBe(nodeRef);
    expect(hex).toBe(knownVectorHex);
  });

  it("2. accepts valid signature within +/-300s replay window (including boundaries)", async () => {
    const headers = await buildSignedHeaders(
      secret,
      rawBody,
      "evt_1",
      baseTimestamp
    );

    const exact = await verifySignedRequest({
      secret,
      rawBody,
      timestampHeader: headers["X-LendLoop-Timestamp"],
      signatureHeader: headers["X-LendLoop-Signature"],
      nowEpochSeconds: baseTimestamp,
    });
    expect(exact.ok).toBe(true);

    const lowerBoundary = await verifySignedRequest({
      secret,
      rawBody,
      timestampHeader: headers["X-LendLoop-Timestamp"],
      signatureHeader: headers["X-LendLoop-Signature"],
      nowEpochSeconds: baseTimestamp + 300,
    });
    expect(lowerBoundary.ok).toBe(true);

    const upperBoundary = await verifySignedRequest({
      secret,
      rawBody,
      timestampHeader: headers["X-LendLoop-Timestamp"],
      signatureHeader: headers["X-LendLoop-Signature"],
      nowEpochSeconds: baseTimestamp - 300,
    });
    expect(upperBoundary.ok).toBe(true);
  });

  it("3. rejects tampered body by 1 character or whitespace change", async () => {
    const headers = await buildSignedHeaders(
      secret,
      rawBody,
      "evt_2",
      baseTimestamp
    );

    const oneCharTampered = await verifySignedRequest({
      secret,
      rawBody: '{"loanId":"j57abc124"}',
      timestampHeader: headers["X-LendLoop-Timestamp"],
      signatureHeader: headers["X-LendLoop-Signature"],
      nowEpochSeconds: baseTimestamp,
    });
    expect(oneCharTampered.ok).toBe(false);
    expect(oneCharTampered.reason).toContain("mismatch");

    const whitespaceTampered = await verifySignedRequest({
      secret,
      rawBody: '{ "loanId": "j57abc123" }',
      timestampHeader: headers["X-LendLoop-Timestamp"],
      signatureHeader: headers["X-LendLoop-Signature"],
      nowEpochSeconds: baseTimestamp,
    });
    expect(whitespaceTampered.ok).toBe(false);
  });

  it("4. rejects expired timestamp (now - 301s) and future timestamp (now + 301s)", async () => {
    const headers = await buildSignedHeaders(
      secret,
      rawBody,
      "evt_3",
      baseTimestamp
    );

    const expired = await verifySignedRequest({
      secret,
      rawBody,
      timestampHeader: headers["X-LendLoop-Timestamp"],
      signatureHeader: headers["X-LendLoop-Signature"],
      nowEpochSeconds: baseTimestamp + 301,
    });
    expect(expired.ok).toBe(false);
    expect(expired.reason).toContain("300s");

    const future = await verifySignedRequest({
      secret,
      rawBody,
      timestampHeader: headers["X-LendLoop-Timestamp"],
      signatureHeader: headers["X-LendLoop-Signature"],
      nowEpochSeconds: baseTimestamp - 301,
    });
    expect(future.ok).toBe(false);
    expect(future.reason).toContain("300s");
  });

  it("5. rejects missing headers, malformed timestamps, and short secrets", async () => {
    const headers = await buildSignedHeaders(
      secret,
      rawBody,
      "evt_4",
      baseTimestamp
    );

    const missingSig = await verifySignedRequest({
      secret,
      rawBody,
      timestampHeader: headers["X-LendLoop-Timestamp"],
      signatureHeader: null,
      nowEpochSeconds: baseTimestamp,
    });
    expect(missingSig.ok).toBe(false);

    const missingTs = await verifySignedRequest({
      secret,
      rawBody,
      timestampHeader: null,
      signatureHeader: headers["X-LendLoop-Signature"],
      nowEpochSeconds: baseTimestamp,
    });
    expect(missingTs.ok).toBe(false);

    const decimalTs = await verifySignedRequest({
      secret,
      rawBody,
      timestampHeader: `${baseTimestamp}.5`,
      signatureHeader: headers["X-LendLoop-Signature"],
      nowEpochSeconds: baseTimestamp,
    });
    expect(decimalTs.ok).toBe(false);

    await expect(computeHmacSha256Hex("short", rawBody)).rejects.toThrow(
      /min 16 chars/i
    );

    const shortSecretVerify = await verifySignedRequest({
      secret: "short",
      rawBody,
      timestampHeader: headers["X-LendLoop-Timestamp"],
      signatureHeader: headers["X-LendLoop-Signature"],
      nowEpochSeconds: baseTimestamp,
    });
    expect(shortSecretVerify.ok).toBe(false);
  });

  it("compares equal and unequal strings in constant time", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
    expect(constantTimeEqual("abc123", "abc124")).toBe(false);
    expect(constantTimeEqual("abc123", "abc1234")).toBe(false);
  });
});
