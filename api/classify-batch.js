import aiHandler from './ai.js';

export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return aiHandler(request);
  }

  const body = await request.json();
  const proxyRequest = new Request(request.url, {
    method: 'POST',
    headers: request.headers,
    body: JSON.stringify({ task: 'classify_batch', ...body }),
  });
  return aiHandler(proxyRequest);
}
