/**
 * Structured error contract (MIGRATION_PLAN.md §5 Step 2.2).
 *
 * Every failure that crosses the Rust bridge, the network or storage is
 * reported as a `VukkoError`. Production code must never answer a failure with
 * a mock success value: callers can rely on `code` to distinguish "no data yet"
 * from "the request failed".
 */

/**
 * Error codes. This list is closed: adding one requires changing the Rust enum
 * too, and the contract parity test enforces it.
 */
export type ErrorCode =
  | 'NOT_INITIALIZED'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'NETWORK'
  | 'AUTHENTICATION'
  | 'STORAGE'
  | 'CANCELLED'
  | 'UNSUPPORTED';

export interface VukkoError {
  code: ErrorCode;
  message: string;
  retryable: boolean;
  /** Extra non-secret context. Never put credentials, tokens or key material here. */
  details?: Record<string, string>;
}

/** Codes that are safe to retry by default. */
const RETRYABLE_BY_DEFAULT: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['NETWORK', 'STORAGE']);

export function isVukkoError(value: unknown): value is VukkoError {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<VukkoError>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.message === 'string' &&
    typeof candidate.retryable === 'boolean'
  );
}

export interface VukkoErrorInit {
  code: ErrorCode;
  message: string;
  retryable?: boolean;
  details?: Record<string, string>;
}

/** Builds a structured error, defaulting retryability from the code. */
export function vukkoError(init: VukkoErrorInit): VukkoError {
  const error: VukkoError = {
    code: init.code,
    message: init.message,
    // A cancelled request is never retryable, whatever the caller asks for:
    // retrying a user's cancellation is always wrong.
    retryable: init.code !== 'CANCELLED' && (init.retryable ?? RETRYABLE_BY_DEFAULT.has(init.code)),
  };
  if (init.details) error.details = redactDetails(init.details);
  return error;
}

/** Coerces anything thrown into the structured contract. */
export function toVukkoError(value: unknown, fallbackCode: ErrorCode = 'UNSUPPORTED'): VukkoError {
  if (isVukkoError(value)) return value;

  if (value instanceof Error) {
    if (value.name === 'AbortError') {
      return vukkoError({ code: 'CANCELLED', message: value.message || 'Request cancelled' });
    }
    return vukkoError({ code: fallbackCode, message: value.message || 'Unexpected error' });
  }

  if (typeof value === 'string' && value.length > 0) {
    return vukkoError({ code: fallbackCode, message: value });
  }

  return vukkoError({ code: fallbackCode, message: 'Unexpected error' });
}

/**
 * True when a retry can plausibly succeed: the error says so AND the work was
 * not cancelled by the user (retrying a cancellation is always wrong).
 */
export function shouldRetry(error: VukkoError): boolean {
  return error.retryable && error.code !== 'CANCELLED';
}

const SECRET_KEY_PATTERN = /(key|token|secret|password|authorization|credential|cookie)/i;

/**
 * Strips anything that looks like credential material from `details`.
 * Diagnostics may be logged; secrets may not.
 */
export function redactDetails(details: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(details)) {
    out[name] = SECRET_KEY_PATTERN.test(name) ? '[redacted]' : value;
  }
  return out;
}

/**
 * Revives an error the bridge rejected with. Malformed or unknown payloads
 * become a structured `UNSUPPORTED` error rather than throwing inside an error
 * handler.
 */
export function parseVukkoError(raw: string): VukkoError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return vukkoError({ code: 'UNSUPPORTED', message: raw || 'Unknown bridge error' });
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return vukkoError({ code: 'UNSUPPORTED', message: String(raw) });
  }

  const candidate = parsed as Partial<VukkoError>;
  if (typeof candidate.code !== 'string' || !KNOWN_CODES.has(candidate.code as ErrorCode)) {
    return vukkoError({
      code: 'UNSUPPORTED',
      message: typeof candidate.message === 'string' ? candidate.message : 'Unknown bridge error',
    });
  }

  return vukkoError({
    code: candidate.code as ErrorCode,
    message: typeof candidate.message === 'string' ? candidate.message : 'Unknown bridge error',
    retryable: typeof candidate.retryable === 'boolean' ? candidate.retryable : undefined,
    details: candidate.details,
  });
}

/** Every code the contract permits; used to validate bridge payloads. */
export const KNOWN_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'NOT_INITIALIZED',
  'NOT_FOUND',
  'VALIDATION',
  'NETWORK',
  'AUTHENTICATION',
  'STORAGE',
  'CANCELLED',
  'UNSUPPORTED',
]);

/** Serialises an error the way the bridge does, dropping undefined details. */
export function serializeVukkoError(error: VukkoError): string {
  const payload: VukkoError = {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
  };
  if (error.details) payload.details = error.details;
  return JSON.stringify(payload);
}
