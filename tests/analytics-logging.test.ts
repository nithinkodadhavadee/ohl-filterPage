import { describe, expect, it } from 'vitest';
import {
  loggerOptions,
  serializeRequest,
  serializeResponse,
  stripQuery,
} from '../src/server/logging.js';

describe('request log redaction', () => {
  it('strips query strings and fragments from URLs', () => {
    expect(stripQuery('/api/books?q=secret&offset=0')).toBe('/api/books');
    expect(stripQuery('/search?q=secret#results')).toBe('/search');
    expect(stripQuery('/status')).toBe('/status');
    expect(stripQuery(undefined)).toBe('');
  });

  it('serialises only method and path, never remoteAddress', () => {
    const serialized = serializeRequest({
      method: 'GET',
      url: '/api/books?q=private-search',
    });
    expect(serialized).toEqual({ method: 'GET', url: '/api/books' });
    expect(JSON.stringify(serialized)).not.toContain('private-search');
    expect(serialized).not.toHaveProperty('remoteAddress');
  });

  it('keeps response status codes', () => {
    expect(serializeResponse({ statusCode: 404 })).toEqual({ statusCode: 404 });
  });

  it('installs the redacting serialisers when logging is enabled', () => {
    expect(loggerOptions(false)).toBe(false);
    const options = loggerOptions(true);
    expect(options).toMatchObject({
      level: 'info',
      serializers: {
        req: serializeRequest,
        res: serializeResponse,
      },
    });
  });
});
