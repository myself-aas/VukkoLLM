/**
 * HTTP → `VukkoError` mapping (MIGRATION_PLAN.md §8 Step 5.3).
 *
 * The Kotlin GitHub/provider clients caught exceptions, logged a line and
 * returned a plausible-looking success. That behaviour is replaced here: every
 * non-2xx response becomes a structured error the UI can act on, and no error
 * message ever echoes credential material.
 */

import type { VukkoError } from '../../types/errors';
import { vukkoError } from '../../types/errors';

/** Wraps a structured error so it can be thrown and still carry its code. */
export class ProviderRequestError extends Error implements VukkoError {
  readonly code: VukkoError['code'];
  readonly retryable: boolean;
  readonly details?: Record<string, string>;

  constructor(error: VukkoError) {
    super(error.message);
    this.name = 'VukkoError';
    this.code = error.code;
    this.retryable = error.retryable;
    if (error.details) this.details = error.details;
  }
}

const CONTEXT_LIMIT_PATTERN =
  /(context.?length|maximum context|too many tokens|context_length_exceeded|prompt is too long)/i;

/** Strips anything that could be a credential from a provider's message. */
function scrub(message: string): string {
  return message
    .replace(/\b(?:sk|rk|ghp|gho|ghs|xoxb|AIza)[-_A-Za-z0-9]{6,}/g, '[redacted key]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]');
}

function providerMessage(body: string): string {
  const trimmed = body.trim();
  if (trimmed.length === 0) return '';
  try {
    const parsed = JSON.parse(trimmed);
    return (
      parsed?.error?.message ?? parsed?.error ?? parsed?.message ?? parsed?.error?.status ?? ''
    );
  } catch {
    // HTML error pages from a proxy: keep the first line only.
    return trimmed.split('\n')[0] ?? '';
  }
}

/**
 * Maps an HTTP status and body to the structured error contract.
 *
 * Rules:
 * - 401/403 → AUTHENTICATION (never retryable: the key will not fix itself)
 * - 404 with a model code → NOT_FOUND, otherwise UNSUPPORTED
 * - 429 and 5xx → NETWORK, retryable
 * - 400 with a context-limit message → VALIDATION with `reason`
 * - anything else → UNSUPPORTED
 */
export function parseErrorResponse(provider: string, status: number, body: string): VukkoError {
  const rawMessage = providerMessage(body);
  const message = scrub(rawMessage) || `HTTP ${status}`;
  const details: Record<string, string> = { provider, status: String(status) };

  if (STATUS_AUTH.includes(status)) {
    if (/model|not found/i.test(rawMessage) && status === 404) {
      return vukkoError({ code: 'NOT_FOUND', message, details });
    }
    const authish = /api.?key|unauthori[sz]ed|authentication|invalid x-api-key|permission/i.test(
      rawMessage,
    );
    if (authish || status === 401 || status === 403) {
      return vukkoError({ code: 'AUTHENTICATION', message, details });
    }
  }

  if (status === 404) {
    if (/model|not found|does not exist/i.test(rawMessage)) {
      return vukkoError({ code: 'NOT_FOUND', message, details });
    }
    return vukkoError({ code: 'UNSUPPORTED', message, details });
  }

  if (status === 400 && CONTEXT_LIMIT_PATTERN.test(rawMessage)) {
    return vukkoError({
      code: 'VALIDATION',
      message,
      retryable: false,
      details: { ...details, reason: 'CONTEXT_LENGTH_EXCEEDED' },
    });
  }

  // A key rejected as *invalid* (not merely missing) is an authentication
  // problem even when the backend reports it as a 400.
  if (/api.?key not valid|invalid.?api.?key|api key expired/i.test(rawMessage)) {
    return vukkoError({ code: 'AUTHENTICATION', message, details });
  }

  if (status === 400 || status === 422) {
    return vukkoError({ code: 'VALIDATION', message, retryable: false, details });
  }

  if (status === 408 || status === 429 || status >= 500) {
    return vukkoError({
      code: 'NETWORK',
      message,
      retryable: true,
      details: { ...details, reason: status === 429 ? 'RATE_LIMITED' : 'UPSTREAM' },
    });
  }

  if (status === 0) {
    return vukkoError({
      code: 'NETWORK',
      message: scrub(rawMessage) || 'network unreachable',
      retryable: true,
      details,
    });
  }

  return vukkoError({ code: 'UNSUPPORTED', message, details });
}

const STATUS_AUTH = [401, 403, 404];
