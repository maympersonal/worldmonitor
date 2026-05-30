const AUTH_REALM = 'World Monitor';
const AUTH_USERNAME_ENV = 'WORLD_MONITOR_AUTH_USERNAME';
const AUTH_PASSWORD_ENV = 'WORLD_MONITOR_AUTH_PASSWORD';

export const config = {
  runtime: 'edge',
  matcher: '/(.*)',
};

export default function middleware(request) {
  const expectedUsername = (process.env[AUTH_USERNAME_ENV] || '').trim();
  const expectedPassword = process.env[AUTH_PASSWORD_ENV] || '';

  if (!expectedUsername && !expectedPassword) return continueRequest();

  if (!expectedUsername || !expectedPassword) {
    return new Response(
      `Authentication is enabled but incomplete. Set both ${AUTH_USERNAME_ENV} and ${AUTH_PASSWORD_ENV}.`,
      {
        status: 503,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
        },
      }
    );
  }

  const credentials = parseBasicAuth(request.headers.get('authorization'));
  const isAuthorized =
    credentials &&
    constantTimeEqual(credentials.username, expectedUsername) &&
    constantTimeEqual(credentials.password, expectedPassword);

  if (isAuthorized) return continueRequest();

  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${AUTH_REALM}", charset="UTF-8"`,
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

function parseBasicAuth(header) {
  if (!header || !header.startsWith('Basic ')) return null;

  try {
    const decoded = atob(header.slice('Basic '.length).trim());
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) return null;

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function continueRequest() {
  return new Response(null, {
    headers: {
      'x-middleware-next': '1',
    },
  });
}

function constantTimeEqual(value, expected) {
  const encoder = new TextEncoder();
  const valueBytes = encoder.encode(value);
  const expectedBytes = encoder.encode(expected);
  const length = Math.max(valueBytes.length, expectedBytes.length);
  let mismatch = valueBytes.length ^ expectedBytes.length;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (valueBytes[index] || 0) ^ (expectedBytes[index] || 0);
  }

  return mismatch === 0;
}
