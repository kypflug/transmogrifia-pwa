/**
 * Azure Function: Google OAuth Token Proxy (BFF)
 *
 * Proxies token exchange and refresh requests to Google's OAuth token endpoint,
 * injecting the client_secret from a server-side environment variable so it
 * never appears in client-side JavaScript.
 *
 * Endpoints:
 *   POST /api/google-token
 *   Body: { grant_type, code?, code_verifier?, redirect_uri?, refresh_token? }
 *
 * The function adds client_id and client_secret before forwarding to Google.
 * Only accepts POST requests and validates the grant_type.
 */

import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CLIENT_ID = '896663119069-nq0ur8ed7c7td44v6o29gu3qdr9t1un7.apps.googleusercontent.com';

interface TokenRequestBody {
  grant_type: string;
  code?: string;
  code_verifier?: string;
  redirect_uri?: string;
  refresh_token?: string;
}

async function handler(
  req: HttpRequest,
  _context: InvocationContext,
): Promise<HttpResponseInit> {
  // Read client_secret from environment (set in Azure Portal → Configuration)
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientSecret) {
    return {
      status: 500,
      jsonBody: { error: 'server_error', error_description: 'GOOGLE_CLIENT_SECRET not configured' },
    };
  }

  let body: TokenRequestBody;
  try {
    body = (await req.json()) as TokenRequestBody;
  } catch {
    return {
      status: 400,
      jsonBody: { error: 'invalid_request', error_description: 'Invalid JSON body' },
    };
  }

  // Validate grant_type
  if (body.grant_type !== 'authorization_code' && body.grant_type !== 'refresh_token') {
    return {
      status: 400,
      jsonBody: { error: 'unsupported_grant_type', error_description: 'Only authorization_code and refresh_token are supported' },
    };
  }

  // Build the form body for Google's token endpoint
  const params = new URLSearchParams();
  params.set('client_id', CLIENT_ID);
  params.set('client_secret', clientSecret);
  params.set('grant_type', body.grant_type);

  if (body.grant_type === 'authorization_code') {
    if (!body.code || !body.redirect_uri) {
      return {
        status: 400,
        jsonBody: { error: 'invalid_request', error_description: 'code and redirect_uri are required for authorization_code grant' },
      };
    }
    params.set('code', body.code);
    params.set('redirect_uri', body.redirect_uri);
    if (body.code_verifier) {
      params.set('code_verifier', body.code_verifier);
    }
  } else {
    if (!body.refresh_token) {
      return {
        status: 400,
        jsonBody: { error: 'invalid_request', error_description: 'refresh_token is required for refresh_token grant' },
      };
    }
    params.set('refresh_token', body.refresh_token);
  }

  // Forward to Google's token endpoint
  const res = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  const responseBody = await res.text();

  return {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
    body: responseBody,
  };
}

app.http('google-token', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'google-token',
  handler,
});
