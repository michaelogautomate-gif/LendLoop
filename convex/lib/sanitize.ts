const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/g;
const MULTILINE_CONTROL_CHARS_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const BEARER_OR_HEX_SECRET_RE =
  /(Bearer\s+[A-Za-z0-9._-]+|sk_(?:live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9+/=]+|[0-9a-f]{48,})/gi;

/**
 * Sanitizes single-line user text (names, titles) by stripping control chars,
 * collapsing internal whitespace, and enforcing min/max bounds.
 */
export function sanitizeSingleLine(
  input: string,
  options: { field: string; minLength: number; maxLength: number }
): string {
  const cleaned = input
    .replace(CONTROL_CHARS_RE, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < options.minLength) {
    throw new Error(
      `${options.field} must be at least ${options.minLength} characters.`
    );
  }
  if (cleaned.length > options.maxLength) {
    throw new Error(
      `${options.field} must be ${options.maxLength} characters or fewer.`
    );
  }
  return cleaned;
}

/**
 * Sanitizes multi-line descriptions/notes while preserving intentional line breaks
 * and capping total length.
 */
export function sanitizeMultiLine(
  input: string,
  options: { field: string; minLength: number; maxLength: number }
): string {
  const cleaned = input
    .replace(/\r\n/g, "\n")
    .replace(MULTILINE_CONTROL_CHARS_RE, "")
    .trim();

  if (cleaned.length < options.minLength) {
    throw new Error(
      `${options.field} must be at least ${options.minLength} characters.`
    );
  }
  if (cleaned.length > options.maxLength) {
    throw new Error(
      `${options.field} must be ${options.maxLength} characters or fewer.`
    );
  }
  return cleaned;
}

export function sanitizeOptionalNote(
  input: string | undefined,
  field: string,
  maxLength = 300
): string | undefined {
  if (input === undefined) return undefined;
  const trimmed = input
    .replace(/\r\n/g, "\n")
    .replace(MULTILINE_CONTROL_CHARS_RE, "")
    .trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) {
    throw new Error(`${field} must be ${maxLength} characters or fewer.`);
  }
  return trimmed;
}

export function sanitizeEmail(email: string | undefined): string {
  return (email ?? "")
    .replace(CONTROL_CHARS_RE, "")
    .trim()
    .toLowerCase();
}

/**
 * Scrubs secret-like tokens and truncates operational error messages before
 * persisting to automationEvents or securityAuditLogs.
 */
export function sanitizeOperationalText(input: string, maxLength = 300): string {
  return input
    .replace(CONTROL_CHARS_RE, " ")
    .replace(BEARER_OR_HEX_SECRET_RE, "[REDACTED]")
    .trim()
    .slice(0, maxLength);
}

