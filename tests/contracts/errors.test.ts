import {
  isVukkoError,
  parseVukkoError,
  redactDetails,
  serializeVukkoError,
  shouldRetry,
  toVukkoError,
  vukkoError,
  type VukkoError,
} from '../../src/types/errors';

describe('vukkoError', () => {
  test('defaults retryability from the code', () => {
    expect(vukkoError({ code: 'NETWORK', message: 'offline' }).retryable).toBe(true);
    expect(vukkoError({ code: 'STORAGE', message: 'disk full' }).retryable).toBe(true);
    expect(vukkoError({ code: 'VALIDATION', message: 'bad name' }).retryable).toBe(false);
    expect(vukkoError({ code: 'AUTHENTICATION', message: 'bad key' }).retryable).toBe(false);
    expect(vukkoError({ code: 'NOT_FOUND', message: 'gone' }).retryable).toBe(false);
  });

  test('an explicit retryable flag wins', () => {
    expect(vukkoError({ code: 'NETWORK', message: 'x', retryable: false }).retryable).toBe(false);
  });

  test('cancellation is never retryable', () => {
    expect(vukkoError({ code: 'CANCELLED', message: 'stopped', retryable: true }).retryable).toBe(
      false,
    );
  });

  test('details are redacted on construction', () => {
    const error = vukkoError({
      code: 'AUTHENTICATION',
      message: 'rejected',
      details: { apiKey: 'sk-live-123', provider: 'OPENAI' },
    });
    expect(error.details).toEqual({ apiKey: '[redacted]', provider: 'OPENAI' });
  });

  test('details are omitted when not supplied', () => {
    expect(vukkoError({ code: 'UNSUPPORTED', message: 'nope' })).not.toHaveProperty('details');
  });
});

describe('toVukkoError', () => {
  test('passes a structured error through unchanged', () => {
    const original = vukkoError({ code: 'NOT_FOUND', message: 'missing' });
    expect(toVukkoError(original)).toBe(original);
  });

  test('maps an AbortError to CANCELLED', () => {
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(toVukkoError(abort)).toEqual({
      code: 'CANCELLED',
      message: 'aborted',
      retryable: false,
    });
  });

  test('maps a plain Error using the fallback code', () => {
    expect(toVukkoError(new Error('kaboom'), 'NETWORK')).toEqual({
      code: 'NETWORK',
      message: 'kaboom',
      retryable: true,
    });
  });

  test('maps a bare string and an unknown value', () => {
    expect(toVukkoError('bad input', 'VALIDATION').message).toBe('bad input');
    expect(toVukkoError(undefined).code).toBe('UNSUPPORTED');
    expect(toVukkoError({ random: true }).code).toBe('UNSUPPORTED');
  });
});

describe('parseVukkoError', () => {
  test('revives the JSON the bridge rejects with', () => {
    const payload = serializeVukkoError(
      vukkoError({ code: 'STORAGE', message: 'disk full', details: { table: 'chat_messages' } }),
    );
    expect(parseVukkoError(payload)).toEqual({
      code: 'STORAGE',
      message: 'disk full',
      retryable: true,
      details: { table: 'chat_messages' },
    });
  });

  test('turns malformed or foreign payloads into a structured error instead of throwing', () => {
    expect(parseVukkoError('not json').code).toBe('UNSUPPORTED');
    expect(parseVukkoError('{"code":"SOMETHING_NEW","message":"x","retryable":false}').code).toBe(
      'UNSUPPORTED',
    );
    expect(parseVukkoError(JSON.stringify({ code: 'NOT_FOUND', message: 'x' })).code).toBe(
      'NOT_FOUND',
    );
  });
});

describe('isVukkoError', () => {
  test.each([
    [{ code: 'NETWORK', message: 'x', retryable: true }, true],
    [{ code: 'NETWORK', message: 'x' }, false],
    [{ message: 'x', retryable: true }, false],
    [null, false],
    ['boom', false],
    [new Error('boom'), false],
  ])('narrows %p correctly', (value, expected) => {
    expect(isVukkoError(value)).toBe(expected);
  });
});

describe('shouldRetry', () => {
  const cases: Array<[VukkoError, boolean]> = [
    [vukkoError({ code: 'NETWORK', message: 'x' }), true],
    [vukkoError({ code: 'VALIDATION', message: 'x' }), false],
    [vukkoError({ code: 'CANCELLED', message: 'x', retryable: true }), false],
  ];

  test.each(cases)('%p → %p', (error, expected) => {
    expect(shouldRetry(error)).toBe(expected);
  });
});

describe('redactDetails', () => {
  test('redacts every credential-shaped key and keeps the rest', () => {
    expect(
      redactDetails({
        token: 'abc',
        refreshToken: 'def',
        sshKey: 'ghi',
        api_key: 'jkl',
        password: 'mno',
        Authorization: 'Bearer xyz',
        credential: 'x',
        cookie: 'y',
        provider: 'GEMINI',
        status: '401',
      }),
    ).toEqual({
      token: '[redacted]',
      refreshToken: '[redacted]',
      sshKey: '[redacted]',
      api_key: '[redacted]',
      password: '[redacted]',
      Authorization: '[redacted]',
      credential: '[redacted]',
      cookie: '[redacted]',
      provider: 'GEMINI',
      status: '401',
    });
  });
});

describe('serializeVukkoError', () => {
  test('produces the bridge payload shape, omitting absent details', () => {
    expect(
      JSON.parse(serializeVukkoError(vukkoError({ code: 'NOT_FOUND', message: 'gone' }))),
    ).toEqual({ code: 'NOT_FOUND', message: 'gone', retryable: false });
  });
});
