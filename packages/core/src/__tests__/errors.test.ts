import { describe, it, expect } from 'vitest';
import {
  isQdrantError, isQdrantNotFoundError, wrapQdrantError,
  QdrantConnectionError,
} from '../errors.js';

describe('isQdrantError', () => {
  const KNOWN_CODES = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'EHOSTUNREACH'];

  it.each(KNOWN_CODES)('returns true for %s', (code) => {
    const err = new Error('network error');
    (err as NodeJS.ErrnoException).code = code;
    expect(isQdrantError(err)).toBe(true);
  });

  it('returns false for non-Error values', () => {
    expect(isQdrantError(null)).toBe(false);
    expect(isQdrantError(undefined)).toBe(false);
    expect(isQdrantError('string error')).toBe(false);
    expect(isQdrantError({ message: 'not an error' })).toBe(false);
  });

  it('returns false for non-network error codes', () => {
    for (const code of ['ENOENT', 'EACCES', 'EPERM', 'EEXIST']) {
      const err = new Error('fs error');
      (err as NodeJS.ErrnoException).code = code;
      expect(isQdrantError(err)).toBe(false);
    }
  });

  it('reads code from cause when top-level code is absent', () => {
    const cause = new Error('inner');
    (cause as NodeJS.ErrnoException).code = 'ECONNREFUSED';
    const err = new Error('wrapping', { cause });
    expect(isQdrantError(err)).toBe(true);
  });

  it('returns false when cause has no code', () => {
    const err = new Error('wrapping', { cause: new Error('inner') });
    expect(isQdrantError(err)).toBe(false);
  });
});

describe('isQdrantNotFoundError', () => {
  it('returns true when cause has status 404', () => {
    const cause = { status: 404 };
    const err = new QdrantConnectionError('not found', cause);
    expect(isQdrantNotFoundError(err)).toBe(true);
  });

  it('returns false for QdrantConnectionError without cause', () => {
    const err = new QdrantConnectionError('generic');
    expect(isQdrantNotFoundError(err)).toBe(false);
  });

  it('returns false when cause has non-404 status', () => {
    const cause = { status: 500 };
    const err = new QdrantConnectionError('server error', cause);
    expect(isQdrantNotFoundError(err)).toBe(false);
  });

  it('returns false for non-QdrantConnectionError', () => {
    expect(isQdrantNotFoundError(new Error('other'))).toBe(false);
  });
});

describe('wrapQdrantError', () => {
  it('includes Docker hint for known network codes', () => {
    const err = new Error('fail');
    (err as NodeJS.ErrnoException).code = 'ENOTFOUND';
    const wrapped = wrapQdrantError(err, 'http://localhost:6333');
    expect(wrapped).toBeInstanceOf(QdrantConnectionError);
    expect(wrapped.message).toContain('docker compose up -d');
    expect(wrapped.message).toContain('http://localhost:6333');
  });

  it('includes raw error message for unknown error types', () => {
    const err = new Error('something unexpected');
    const wrapped = wrapQdrantError(err, 'http://localhost:6333');
    expect(wrapped.message).toContain('something unexpected');
    expect(wrapped.message).not.toContain('docker compose');
  });
});
