// OpenAPI 3.1 description of the public API, served at GET /api/openapi.json.
// tests/api/openapi.test.js fails if this document and server/router.js ROUTES disagree.

const ID = { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
const TOKEN_PARAM = { name: 'token', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
const UNAUTHORIZED = { description: 'Not signed in or invalid API token', content: errorContent() }
const NOT_FOUND = { description: 'Not found (also returned for drafts the caller does not own)', content: errorContent() }
const IF_MATCH = {
  name: 'If-Match',
  in: 'header',
  required: false,
  description:
    'The draft version you read as an entity tag, for example "3", or * for any version. Weak tags (W/"3") never match on a write. A malformed value is 400.',
  schema: { type: 'string' }
}
const PRECONDITION_FAILED = {
  description: 'If-Match does not match the current version. Nothing was written. Body: { error, version } with the current version; the ETag header has it too.',
  content: errorContent()
}
const BAD_REQUEST = { description: 'Invalid input', content: errorContent() }
const BEARER = [{ bearerAuth: [] }, { cookieAuth: [] }]

function errorContent() {
  return { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
}

function json(schema, status = '200') {
  return { [status]: { description: 'OK', content: { 'application/json': { schema } } } }
}

const draftRef = { $ref: '#/components/schemas/Draft' }
const tokenRef = { $ref: '#/components/schemas/ApiToken' }
const grantRef = { $ref: '#/components/schemas/Grant' }
const FORBIDDEN = { description: 'An OAuth grant was used; a browser session or personal API token is required', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }

export const OPENAPI = {
  openapi: '3.1.0',
  info: {
    title: 'X Thread Draft Tool API',
    version: '1.0.0',
    description:
      'Create, edit, publish and share thread drafts. Authenticate with a personal API token ' +
      '(Authorization: Bearer xt_...) or a browser session cookie. Same permissions as the web UI.'
  },
  servers: [{ url: '/api' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'xt_ API token' },
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'xt_session' }
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: { error: { type: 'string' } }
      },
      Post: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          text: { type: 'string', maxLength: 280 },
          images: { type: 'array', maxItems: 4, items: { type: 'object', properties: { url: { type: 'string' } } } },
          embeddedTweet: { type: ['string', 'null'] }
        }
      },
      Draft: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          user_id: { type: 'string', format: 'uuid' },
          title: { type: 'string', maxLength: 500 },
          posts: { type: 'array', items: { $ref: '#/components/schemas/Post' } },
          is_published: { type: 'boolean' },
          published_at: { type: ['string', 'null'], format: 'date-time' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
          version: { type: 'integer', minimum: 1, description: 'Goes up by one on every write. Send it as the If-Match entity tag on a write.' }
        }
      },
      ApiToken: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          prefix: { type: 'string', example: 'xt_AbC1234' },
          created_via: { type: 'string', enum: ['web', 'device'] },
          created_at: { type: 'string', format: 'date-time' },
          last_used_at: { type: ['string', 'null'], format: 'date-time' },
          expires_at: { type: ['string', 'null'], format: 'date-time' },
          revoked_at: { type: ['string', 'null'], format: 'date-time' }
        }
      },
      Grant: {
        type: 'object',
        description: 'A connected app: one OAuth grant of yours. Never includes tokens or codes.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          client_name: { type: 'string' },
          kind: { type: 'string', enum: ['registered', 'metadata', 'device'] },
          redirect_host: { type: ['string', 'null'], example: 'localhost:3000' },
          resource: { type: 'string', example: 'https://x-thread-draft-tool.vercel.app/api/mcp' },
          scope: { type: 'string', example: 'drafts' },
          created_at: { type: 'string', format: 'date-time' },
          last_used_at: { type: ['string', 'null'], format: 'date-time' },
          revoked_at: { type: ['string', 'null'], format: 'date-time' }
        }
      }
    }
  },
  paths: {
    '/health': { get: { summary: 'Health check', responses: json({ type: 'object', properties: { ok: { type: 'boolean' } } }) } },
    '/openapi.json': { get: { summary: 'This document', responses: json({ type: 'object' }) } },
    '/.well-known/oauth-protected-resource': {
      get: { servers: [{ url: '/' }], summary: 'Protected resource metadata (RFC 9728), MCP resource at /api/mcp', responses: json({ type: 'object' }) }
    },
    '/.well-known/oauth-protected-resource/api/mcp': {
      get: { servers: [{ url: '/' }], summary: 'Protected resource metadata for the MCP endpoint (RFC 9728)', responses: json({ type: 'object' }) }
    },
    '/.well-known/oauth-authorization-server': {
      get: { servers: [{ url: '/' }], summary: 'Authorization server metadata (RFC 8414)', responses: json({ type: 'object' }) }
    },
    '/oauth/register': {
      post: {
        summary: 'Register a public OAuth client (RFC 7591, deprecated in favour of client ID metadata documents)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: {
          201: { description: 'Client registered', content: { 'application/json': { schema: { type: 'object' } } } },
          400: { description: 'invalid_client_metadata', content: errorContent() }
        }
      }
    },
    '/oauth/authorize': {
      get: {
        summary: 'Authorization request (PKCE S256 and resource required). Shows the consent page.',
        parameters: [
          { name: 'response_type', in: 'query', required: true, schema: { type: 'string', enum: ['code'] } },
          { name: 'client_id', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'redirect_uri', in: 'query', required: true, schema: { type: 'string', format: 'uri' } },
          { name: 'code_challenge', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'code_challenge_method', in: 'query', required: true, schema: { type: 'string', enum: ['S256'] } },
          { name: 'resource', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'state', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'scope', in: 'query', required: false, schema: { type: 'string', enum: ['drafts'] } }
        ],
        responses: { 200: { description: 'Consent page (HTML)' }, 302: { description: 'Sign-in or redirect with code or error' }, 400: { description: 'Unknown client or redirect URI (HTML)' } }
      },
      post: {
        summary: 'Approve or deny the consent page (form post)',
        requestBody: { required: true, content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } } },
        responses: { 302: { description: 'Redirect to the client with code or error' }, 403: { description: 'Wrong account (HTML)' } }
      }
    },
    '/oauth/logout': {
      post: {
        summary: 'Consent page "Not you? Sign out" (form post, browser cookie only). Ends the session, then redirects to the sign-in page for the same request.',
        requestBody: { required: true, content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } } },
        responses: { 302: { description: 'Redirect to /api/oauth/authorize built from the signed request' }, 400: { description: 'Request expired (HTML)' }, 403: { description: 'Wrong account (HTML)' } }
      }
    },
    '/oauth/token': {
      post: {
        summary: 'Token endpoint: authorization_code (with PKCE) and refresh_token grants',
        requestBody: { required: true, content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } } },
        responses: {
          ...json({ type: 'object', properties: { access_token: { type: 'string' }, refresh_token: { type: 'string' }, token_type: { type: 'string' }, expires_in: { type: 'integer' }, scope: { type: 'string' } } }),
          400: { description: 'invalid_request, invalid_grant, invalid_target or unsupported_grant_type', content: errorContent() }
        }
      }
    },
    '/oauth/revoke': {
      post: {
        summary: 'Revoke the grant a token belongs to (always 200)',
        requestBody: { required: true, content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } } },
        responses: { 200: { description: 'Revoked (or nothing to revoke)' } }
      }
    },
    '/mcp': {
      post: {
        summary: 'MCP endpoint (Streamable HTTP, JSON responses): one JSON-RPC message per POST. Needs an OAuth access token for /api/mcp.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['jsonrpc', 'method'] } } } },
        responses: {
          200: { description: 'JSON-RPC response', content: { 'application/json': { schema: { type: 'object' } } } },
          202: { description: 'Notification accepted (no body)' },
          401: { description: 'Missing or invalid access token; WWW-Authenticate points at the protected resource metadata', content: errorContent() },
          403: { description: 'Origin is not this app', content: errorContent() }
        }
      }
    },
    '/auth/login': { get: { summary: 'Start GitHub OAuth sign-in (browser redirect)', responses: { 302: { description: 'Redirect to GitHub' } } } },
    '/auth/callback': { get: { summary: 'GitHub OAuth callback (browser)', responses: { 302: { description: 'Redirect to the app' }, 400: BAD_REQUEST } } },
    '/auth/me': {
      get: {
        summary: 'Current user',
        security: BEARER,
        responses: {
          ...json({
            type: 'object',
            properties: {
              user: { type: ['object', 'null'] },
              auth: { type: ['string', 'null'], enum: ['session', 'token', null] }
            }
          }),
          401: UNAUTHORIZED
        }
      }
    },
    '/auth/logout': { post: { summary: 'End this browser session on the server (the cookie is revoked, not only cleared). API tokens and connected AI apps stay; the settings page disconnects them', responses: json({ type: 'object', properties: { ok: { type: 'boolean' } } }) } },
    '/auth/device/start': {
      post: {
        summary: 'Start GitHub device flow for an agent. Show the user the code and URL, then poll.',
        responses: json({
          type: 'object',
          properties: {
            device_code: { type: 'string' },
            user_code: { type: 'string', example: 'ABCD-1234' },
            verification_uri: { type: 'string' },
            interval: { type: 'integer' },
            expires_in: { type: 'integer' }
          }
        }),
        'x-agent-note': 'Requires Device Flow enabled on the GitHub OAuth App.'
      }
    },
    '/auth/device/poll': {
      post: {
        summary: 'Poll the device flow. 202 while pending; 201 returns an access token (1 hour) and a refresh token once approved.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['device_code'], properties: { device_code: { type: 'string' }, name: { type: 'string', maxLength: 100 } } } } } },
        responses: {
          202: { description: 'Still waiting for approval', content: { 'application/json': { schema: { type: 'object', properties: { status: { const: 'pending' }, interval: { type: 'integer' } } } } } },
          ...json({ type: 'object', properties: { access_token: { type: 'string', example: 'xta_…' }, refresh_token: { type: 'string', example: 'xtr_…' }, token_type: { const: 'Bearer' }, expires_in: { type: 'integer', example: 3600 }, scope: { type: 'string', example: 'drafts' }, client_id: { type: 'string', example: 'device:Claude agent' }, token: { type: 'string', description: 'Deprecated alias of access_token, removed one release later' }, user: { type: 'object' } } }, '201'),
          400: { description: 'Denied, expired or invalid device code', content: errorContent() }
        }
      }
    },
    '/tokens': {
      get: {
        summary: 'List your API tokens (never shows the secret)',
        security: BEARER,
        responses: { ...json({ type: 'object', properties: { tokens: { type: 'array', items: tokenRef } } }), 401: UNAUTHORIZED }
      },
      post: {
        summary: 'Create an API token. Browser session only (bearer tokens are refused). Shown once.',
        security: [{ cookieAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 100 }, expires_in_days: { type: 'integer', minimum: 1, maximum: 7, default: 7 } } } } } },
        responses: {
          ...json({ type: 'object', properties: { token: { type: 'string' }, id: { type: 'string' }, name: { type: 'string' }, prefix: { type: 'string' }, expires_at: { type: 'string' } } }, '201'),
          400: BAD_REQUEST,
          401: UNAUTHORIZED,
          403: { description: 'A bearer token was used; a browser session is required', content: errorContent() },
          409: { description: 'More than 20 active tokens', content: errorContent() }
        }
      }
    },
    '/tokens/{id}': {
      delete: {
        summary: 'Revoke one of your API tokens',
        security: BEARER,
        parameters: [ID],
        responses: { ...json({ type: 'object', properties: { ok: { type: 'boolean' } } }), 401: UNAUTHORIZED, 404: NOT_FOUND }
      }
    },
    '/grants': {
      get: {
        summary: 'List your connected apps (OAuth grants), revoked ones included. Browser session or personal token only; OAuth access tokens get 403.',
        security: BEARER,
        responses: { ...json({ type: 'object', properties: { grants: { type: 'array', items: grantRef } } }), 401: UNAUTHORIZED, 403: FORBIDDEN }
      }
    },
    '/grants/{id}': {
      delete: {
        summary: 'Revoke one of your connected apps. Its access and refresh tokens stop working at once. Browser session or personal token only.',
        security: BEARER,
        parameters: [ID],
        responses: { ...json({ type: 'object', properties: { ok: { type: 'boolean' } } }), 401: UNAUTHORIZED, 403: FORBIDDEN, 404: NOT_FOUND }
      }
    },
    '/drafts': {
      get: {
        summary: 'List your drafts (newest first). Limit defaults to 100, max 200; no cursor yet.',
        security: BEARER,
        parameters: [
          { name: 'published', in: 'query', required: true, schema: { type: 'string', enum: ['true', 'false'] } },
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200, default: 100 } }
        ],
        responses: { ...json({ type: 'object', properties: { drafts: { type: 'array', items: draftRef } } }), 400: BAD_REQUEST, 401: UNAUTHORIZED }
      },
      post: {
        summary: 'Create a draft',
        security: BEARER,
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string', maxLength: 500 }, posts: { type: 'array', items: { $ref: '#/components/schemas/Post' } } } } } } },
        responses: { ...json({ type: 'object', properties: { draft: draftRef } }, '201'), 400: BAD_REQUEST, 401: UNAUTHORIZED }
      }
    },
    '/drafts/{id}': {
      get: {
        summary: 'Read a draft by id (owner only: another user gets 404, a signed-out caller 401). The ETag header is the draft version, for example "3".',
        security: BEARER,
        parameters: [ID],
        responses: { ...json({ type: 'object', properties: { draft: draftRef } }), 401: UNAUTHORIZED, 404: NOT_FOUND }
      },
      patch: {
        summary: 'Update title and/or posts (owner only). One transaction; sending what the draft already holds is a 200 with no write; a stale If-Match is 412. Every write bumps version and returns an ETag.',
        security: BEARER,
        parameters: [ID, IF_MATCH],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string', maxLength: 500 }, posts: { type: 'array', items: { $ref: '#/components/schemas/Post' } } } } } } },
        responses: { ...json({ type: 'object', properties: { draft: draftRef } }), 400: BAD_REQUEST, 401: UNAUTHORIZED, 404: NOT_FOUND, 412: PRECONDITION_FAILED }
      },
      delete: {
        summary: 'Delete a draft and its Blob images (owner only)',
        security: BEARER,
        parameters: [ID],
        responses: { ...json({ type: 'object', properties: { ok: { type: 'boolean' } } }), 401: UNAUTHORIZED, 404: NOT_FOUND }
      }
    },
    '/drafts/{id}/publish': {
      post: {
        summary: 'Publish: deletes the draft images and clears them from posts (owner only). One transaction; publishing a published draft is a 200 with no write; a stale If-Match is 412.',
        security: BEARER,
        parameters: [ID, IF_MATCH],
        responses: { ...json({ type: 'object', properties: { draft: draftRef } }), 400: BAD_REQUEST, 401: UNAUTHORIZED, 404: NOT_FOUND, 412: PRECONDITION_FAILED }
      }
    },
    '/drafts/{id}/duplicate': {
      post: {
        summary: 'Copy a draft (new post ids, title "<title> (copy)"). Owner only.',
        security: BEARER,
        parameters: [ID],
        responses: { ...json({ type: 'object', properties: { draft: draftRef } }, '201'), 401: UNAUTHORIZED, 404: NOT_FOUND }
      }
    },
    '/drafts/{id}/export': {
      get: {
        summary: 'Export a draft as JSON, plain text, or numbered text. Owner only, like GET by id.',
        security: BEARER,
        parameters: [ID, { name: 'format', in: 'query', required: false, schema: { type: 'string', enum: ['json', 'text', 'formatted'], default: 'json' } }, { name: 'numbered', in: 'query', required: false, description: 'With format=text: put an i/N line before each post.', schema: { type: 'boolean', default: false } }],
        responses: {
          200: { description: 'The exported draft', content: { 'application/json': { schema: { type: 'object' } }, 'text/plain': { schema: { type: 'string' } } } },
          400: BAD_REQUEST,
          401: UNAUTHORIZED,
          404: NOT_FOUND
        }
      }
    },
    '/drafts/{id}/share-tokens': {
      post: {
        summary: 'Create a share link (owner only). Default: works once, expires after 1 hour. Use /share/{token} for the markdown or HTML page. An empty body means the defaults.',
        security: BEARER,
        parameters: [ID],
        requestBody: { required: false, content: { 'application/json': { schema: { type: 'object', properties: { expires_in: { type: 'integer', minimum: 60, maximum: 604800, default: 3600, description: 'Lifetime in seconds.' }, one_time: { type: 'boolean', default: true, description: 'false: the link can be read until it expires.' } } } } } },
        responses: { ...json({ type: 'object', properties: { token: { type: 'string', format: 'uuid' }, expires_at: { type: 'string', format: 'date-time' }, one_time: { type: 'boolean' } } }, '201'), 400: BAD_REQUEST, 401: UNAUTHORIZED, 404: NOT_FOUND }
      },
      delete: {
        summary: 'Stop every share link of the draft (owner only). Each one then returns 410.',
        security: BEARER,
        parameters: [ID],
        responses: { 204: { description: 'All links of the draft are stopped' }, 401: UNAUTHORIZED, 404: NOT_FOUND }
      }
    },
    '/drafts/{id}/share-tokens/{token}': {
      delete: {
        summary: 'Stop one share link (owner only). The link then returns 410.',
        security: BEARER,
        parameters: [ID, TOKEN_PARAM],
        responses: { 204: { description: 'The link is stopped' }, 401: UNAUTHORIZED, 404: NOT_FOUND }
      }
    },
    '/drafts/{id}/posts/{postId}': {
      patch: {
        summary: 'Change the text of one post only (owner only). One transaction: a replay of the same text is a 200 with no write; If-Match with a stale version is 412. Other posts, images and the embedded tweet are unchanged.',
        security: BEARER,
        parameters: [
          ID,
          { name: 'postId', in: 'path', required: true, schema: { type: 'string' } },
          IF_MATCH
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['text'], additionalProperties: false, properties: { text: { type: 'string', maxLength: 280 } } } } } },
        responses: {
          ...json({ type: 'object', properties: { draft: draftRef } }),
          400: BAD_REQUEST,
          401: UNAUTHORIZED,
          404: NOT_FOUND,
          409: { description: 'The draft is published. Duplicate it to edit.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          412: PRECONDITION_FAILED
        }
      }
    },
    '/images': {
      post: {
        summary: 'Upload an image for a draft: raw bytes, Content-Type image/*, max 4 MB (owner only)',
        security: BEARER,
        parameters: [{ name: 'draftId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'image/*': { schema: { type: 'string', format: 'binary' } } } },
        responses: { ...json({ type: 'object', properties: { url: { type: 'string' } } }, '201'), 401: UNAUTHORIZED, 404: NOT_FOUND, 413: BAD_REQUEST, 415: BAD_REQUEST }
      },
      delete: {
        summary: 'Delete one of your own uploaded images by URL',
        security: BEARER,
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } } } } },
        responses: { ...json({ type: 'object', properties: { ok: { type: 'boolean' } } }), 401: UNAUTHORIZED, 403: { description: 'Not your image', content: errorContent() } }
      }
    },
    '/images/from-url': {
      post: {
        summary: 'Fetch a public image URL on the server and store it for a draft (owner only). Redirects and private addresses are refused.',
        security: BEARER,
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['draftId', 'url'], properties: { draftId: { type: 'string', format: 'uuid' }, url: { type: 'string', format: 'uri' } } } } } },
        responses: { ...json({ type: 'object', properties: { url: { type: 'string' }, sourceUrl: { type: 'string' } } }, '201'), 400: BAD_REQUEST, 401: UNAUTHORIZED, 404: NOT_FOUND, 415: BAD_REQUEST, 502: { description: 'Image host failed', content: errorContent() } }
      }
    },
    '/share/{token}': {
      get: {
        summary: 'Read a share link. A one-time link works once; a reusable link works until it expires or is stopped. Otherwise 410. Append .md, .html or ?format=html|md.',
        parameters: [TOKEN_PARAM],
        responses: {
          200: { description: 'Markdown (default) or HTML', content: { 'text/markdown': { schema: { type: 'string' } }, 'text/html': { schema: { type: 'string' } } } },
          400: BAD_REQUEST,
          410: { description: 'Expired, stopped, already used or unknown', content: { 'text/markdown': { schema: { type: 'string' } } } }
        }
      }
    },
    '/threads/split': {
      post: {
        summary: 'Split text into thread-sized posts with the editor\'s splitter (no auth)',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, max_chars: { type: 'integer', minimum: 20, maximum: 1000, default: 280 } } } } } },
        responses: { ...json({ type: 'object', properties: { posts: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, chars: { type: 'integer' } } } } } }), 400: BAD_REQUEST }
      }
    }
  }
}
