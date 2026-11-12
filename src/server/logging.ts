import type { FastifyServerOptions } from 'fastify';

export function stripQuery(url: string | undefined): string {
  if (!url) return '';
  const queryIndex = url.indexOf('?');
  const hashIndex = url.indexOf('#');
  let end = url.length;
  if (queryIndex >= 0 && queryIndex < end) end = queryIndex;
  if (hashIndex >= 0 && hashIndex < end) end = hashIndex;
  return url.slice(0, end);
}

interface RequestLike {
  method?: string;
  url?: string;
}

interface ResponseLike {
  statusCode?: number;
}

export function serializeRequest(request: RequestLike): Record<string, unknown> {
  return {
    method: request.method,
    url: stripQuery(request.url),
  };
}

export function serializeResponse(response: ResponseLike): Record<string, unknown> {
  return {
    statusCode: response.statusCode,
  };
}

export function loggerOptions(enabled: boolean): FastifyServerOptions['logger'] {
  if (!enabled) return false;
  return {
    level: 'info',
    serializers: {
      req: serializeRequest,
      res: serializeResponse,
    },
  };
}
