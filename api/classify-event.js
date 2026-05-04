import aiHandler from './ai.js';

export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return aiHandler(new Request(request.url, { method: 'OPTIONS', headers: request.headers }));
  }

  const url = new URL(request.url);
  const title = url.searchParams.get('title');
  const variant = url.searchParams.get('variant') || 'full';
  const proxyRequest = new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify({ task: 'classify_single', title, variant }),
  });
  return aiHandler(proxyRequest);
}
