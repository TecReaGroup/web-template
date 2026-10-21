import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { log, serializeError } from '../infrastructure/logger.mjs';
import { sendJson } from '../shared/http.mjs';
import { streamFrontend } from './static-handler.mjs';

async function routeRequest(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    sendJson(response, 404, { error: 'Route not found' });
    return;
  }

  if (request.method === 'GET') {
    if (await streamFrontend(response, url.pathname)) return;
    if (!extname(url.pathname) && await streamFrontend(response, '/')) return;
  }

  sendJson(response, 404, { error: 'Route not found' });
}

export async function handleRequest(request, response) {
  const requestId = request.headers['x-request-id']?.toString().slice(0, 128) || randomUUID();
  const startedAt = Date.now();
  response.setHeader('X-Request-Id', requestId);

  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    await routeRequest(request, response, url);
  } catch (error) {
    if (request.aborted || response.destroyed || error?.code === 'ECONNRESET' || error?.code === 'ECONNABORTED') return;
    log('error', 'HTTP', 'Request failed', {
      requestId,
      method: request.method,
      durationMs: Date.now() - startedAt,
      error: serializeError(error),
    });
    if (response.headersSent) {
      response.destroy();
      return;
    }
    sendJson(response, error instanceof URIError ? 400 : 500, {
      error: error instanceof URIError ? 'Invalid request path' : 'Internal server error',
    });
  }
}
