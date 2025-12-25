# Cloudflare Infrastructure Standards

## Overview

Prisma primarily uses Cloudflare's infrastructure for hosting applications. This document outlines standards for Cloudflare Workers, Pages, and related services.

## Cloudflare Workers

### Worker Structure
Organize Workers code for maintainability and testability.

**Guidelines:**
- Use modular structure with clear separation of concerns
- Extract business logic from request handling
- Use TypeScript for type safety
- Keep Workers lightweight and focused
- Use Miniflare for local development

**Example Structure:**
```typescript
// src/index.ts
import { handleRequest } from './handlers';
import { errorHandler } from './middleware/errors';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(request, env, ctx);
    } catch (error) {
      return errorHandler(error);
    }
  }
};

// src/handlers/index.ts
export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/api/users') {
    return handleUsers(request, env);
  }

  return new Response('Not Found', { status: 404 });
}
```

### Environment Variables and Secrets
Use Cloudflare's environment variables and secrets management.

**Guidelines:**
- Use wrangler.toml for non-sensitive configuration
- Use Workers Secrets for sensitive data (API keys, tokens)
- Validate all required environment variables on startup
- Use different environments for dev/staging/production
- Never commit secrets to version control

**Example wrangler.toml:**
```toml
name = "my-worker"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[env.production]
name = "my-worker-production"
vars = { ENVIRONMENT = "production" }

[env.staging]
name = "my-worker-staging"
vars = { ENVIRONMENT = "staging" }

[env.development]
name = "my-worker-dev"
vars = { ENVIRONMENT = "development" }
```

**Setting secrets:**
```bash
# Set secret for production
wrangler secret put API_KEY --env production

# List secrets
wrangler secret list --env production
```

### Workers KV
Use Workers KV for low-latency key-value storage.

**Guidelines:**
- KV is eventually consistent - design for this
- Use KV for read-heavy workloads
- Cache frequently accessed data
- Set appropriate expiration times
- Consider data size limits (25 MB per value)
- Use list operations sparingly (expensive)

**Example:**
```typescript
// ✅ Good KV usage
async function getCachedUser(userId: string, env: Env): Promise<User | null> {
  // Try cache first
  const cached = await env.USERS_KV.get(`user:${userId}`, 'json');
  if (cached) {
    return cached as User;
  }

  // Fetch from source
  const user = await fetchUserFromDatabase(userId);

  // Cache for 5 minutes
  await env.USERS_KV.put(
    `user:${userId}`,
    JSON.stringify(user),
    { expirationTtl: 300 }
  );

  return user;
}

// ❌ Bad - listing all keys
async function getAllUsers(env: Env) {
  const list = await env.USERS_KV.list(); // Expensive!
  // Don't use KV as a database
}
```

### Durable Objects
Use Durable Objects for strongly consistent, stateful workloads.

**Guidelines:**
- Use for coordination, sessions, real-time features
- Each Durable Object is a single-threaded instance
- Design for eventual consistency across objects
- Use alarms for scheduled tasks
- Keep state small and focused
- Handle errors gracefully - objects can be evicted

**Example:**
```typescript
// ✅ Good Durable Object
export class RateLimiter {
  private state: DurableObjectState;
  private requests: Map<string, number[]>;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.requests = new Map();
  }

  async fetch(request: Request): Promise<Response> {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const now = Date.now();

    // Get recent requests for this IP
    const recentRequests = this.requests.get(ip) || [];

    // Remove requests older than 1 minute
    const validRequests = recentRequests.filter(
      time => now - time < 60000
    );

    // Check rate limit (100 requests per minute)
    if (validRequests.length >= 100) {
      return new Response('Rate limit exceeded', { status: 429 });
    }

    // Add current request
    validRequests.push(now);
    this.requests.set(ip, validRequests);

    return new Response('OK', { status: 200 });
  }
}
```

### R2 Storage
Use R2 for object storage (files, images, backups).

**Guidelines:**
- Use R2 for large files (> 25 MB)
- Implement proper access controls
- Use presigned URLs for direct uploads/downloads
- Set appropriate CORS policies
- Consider multipart uploads for large files
- Use lifecycle policies for data retention

**Example:**
```typescript
// ✅ Upload to R2
async function uploadFile(
  file: File,
  key: string,
  env: Env
): Promise<void> {
  const arrayBuffer = await file.arrayBuffer();

  await env.MY_BUCKET.put(key, arrayBuffer, {
    httpMetadata: {
      contentType: file.type,
    },
    customMetadata: {
      uploadedBy: 'user-123',
      uploadedAt: new Date().toISOString()
    }
  });
}

// ✅ Generate presigned URL for download
async function getDownloadUrl(
  key: string,
  env: Env
): Promise<string> {
  const object = await env.MY_BUCKET.get(key);

  if (!object) {
    throw new Error('File not found');
  }

  // Generate URL that expires in 1 hour
  return await object.signedUrl({
    expiresIn: 3600
  });
}
```

### Request Handling

#### CORS Configuration
Configure CORS appropriately for your use case.

**Example:**
```typescript
// ✅ Proper CORS handling
function handleCORS(request: Request): Response | null {
  const origin = request.headers.get('Origin');

  // Only allow specific origins in production
  const allowedOrigins = [
    'https://example.com',
    'https://app.example.com'
  ];

  if (!origin || !allowedOrigins.includes(origin)) {
    return new Response('Forbidden', { status: 403 });
  }

  // Handle preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400'
      }
    });
  }

  return null;
}

// Add CORS headers to response
function addCORSHeaders(response: Response, origin: string): Response {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('Access-Control-Allow-Origin', origin);
  newHeaders.set('Access-Control-Allow-Credentials', 'true');

  return new Response(response.body, {
    status: response.status,
    headers: newHeaders
  });
}
```

#### Error Handling
Handle errors consistently in Workers.

**Example:**
```typescript
// ✅ Consistent error handling
class APIError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string
  ) {
    super(message);
    this.name = 'APIError';
  }
}

function errorHandler(error: unknown): Response {
  console.error('Request failed:', error);

  if (error instanceof APIError) {
    return new Response(
      JSON.stringify({
        error: error.message,
        code: error.code
      }),
      {
        status: error.statusCode,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  // Unknown error - don't expose details
  return new Response(
    JSON.stringify({ error: 'Internal server error' }),
    {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    }
  );
}
```

### Performance Optimization

#### Caching
Leverage Cloudflare's CDN and caching capabilities.

**Guidelines:**
- Set appropriate Cache-Control headers
- Use Cloudflare's cache API for custom caching
- Cache static assets aggressively
- Use stale-while-revalidate for dynamic content
- Vary cache by relevant headers

**Example:**
```typescript
// ✅ Custom caching strategy
async function handleCachedRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext
): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(request.url, request);

  // Try cache first
  let response = await cache.match(cacheKey);

  if (!response) {
    // Generate response
    response = await generateResponse(request, env);

    // Cache for 1 hour
    const cacheHeaders = new Headers(response.headers);
    cacheHeaders.set('Cache-Control', 'public, max-age=3600');

    response = new Response(response.body, {
      status: response.status,
      headers: cacheHeaders
    });

    // Store in cache
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return response;
}
```

## Cloudflare Pages

### Pages Configuration
Configure Pages for optimal performance and security.

**Guidelines:**
- Use Pages Functions for server-side logic
- Set appropriate build settings
- Configure custom domains and SSL
- Use environment variables for configuration
- Enable Branch Previews for testing

**Example _headers file:**
```
# Security headers
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()

# Cache static assets
/static/*
  Cache-Control: public, max-age=31536000, immutable

# Don't cache HTML
/*.html
  Cache-Control: public, max-age=0, must-revalidate
```

### Pages Functions
Use Pages Functions for server-side functionality.

**Example:**
```typescript
// functions/api/users/[id].ts
interface Env {
  DATABASE_URL: string;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const userId = context.params.id as string;

  try {
    const user = await fetchUser(userId, context.env);

    return new Response(JSON.stringify(user), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response('User not found', { status: 404 });
  }
};
```

## Deployment Best Practices

### Wrangler Configuration
Use wrangler for deployments and local development.

**Guidelines:**
- Keep wrangler.toml in version control
- Use separate environments for dev/staging/production
- Use `wrangler dev` for local development
- Test with Miniflare before deploying
- Use `--dry-run` to preview deployments

**Common commands:**
```bash
# Local development
wrangler dev

# Deploy to production
wrangler deploy --env production

# View logs
wrangler tail --env production

# Test before deploy
wrangler deploy --dry-run --env production
```

### Gradual Rollouts
Use gradual rollouts for critical changes.

**Guidelines:**
- Use Cloudflare's gradual deployments
- Monitor error rates during rollout
- Have rollback plan ready
- Test thoroughly in staging first
- Use feature flags for risky changes

## Monitoring and Observability

### Logging
Implement structured logging for debugging.

**Example:**
```typescript
// ✅ Structured logging
interface LogEntry {
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
  requestId?: string;
  userId?: string;
  [key: string]: unknown;
}

function log(entry: Omit<LogEntry, 'timestamp'>): void {
  const logEntry: LogEntry = {
    ...entry,
    timestamp: new Date().toISOString()
  };

  console.log(JSON.stringify(logEntry));
}

// Usage
log({
  level: 'info',
  message: 'User created',
  userId: user.id,
  email: user.email
});
```

### Error Tracking
Integrate error tracking services.

**Guidelines:**
- Send errors to monitoring service (Sentry, etc.)
- Include context with errors
- Set up alerts for critical errors
- Track error rates and trends
- Don't log sensitive data

## Cost Optimization

### Resource Usage
Optimize for Cloudflare's pricing model.

**Guidelines:**
- Workers: Optimize CPU time (paid per request + CPU time)
- KV: Minimize reads and writes (billed per operation)
- R2: Optimize storage class usage (infrequent access vs standard)
- Durable Objects: Minimize number of objects (billed per object + requests)
- Monitor usage in Cloudflare dashboard

### Efficient Patterns
```typescript
// ✅ Batch KV operations when possible
async function getCachedItems(keys: string[], env: Env): Promise<Map<string, any>> {
  const results = new Map();

  // Get all values in parallel
  const promises = keys.map(async key => {
    const value = await env.KV.get(key, 'json');
    return [key, value] as const;
  });

  const entries = await Promise.all(promises);
  entries.forEach(([key, value]) => {
    if (value) results.set(key, value);
  });

  return results;
}
```

## Security Considerations

### Worker Security
Protect Workers from common attacks.

**Guidelines:**
- Validate all inputs
- Implement rate limiting
- Use HTTPS only
- Set security headers
- Sanitize error messages
- Use Workers Secrets for sensitive data

**Example security headers:**
```typescript
function addSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);

  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'"
  );

  return new Response(response.body, {
    status: response.status,
    headers
  });
}
```

## Testing

### Local Testing with Miniflare
Test Workers locally before deploying.

**Example:**
```typescript
// test/worker.test.ts
import { unstable_dev } from 'wrangler';

describe('Worker', () => {
  let worker: Awaited<ReturnType<typeof unstable_dev>>;

  beforeAll(async () => {
    worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true }
    });
  });

  afterAll(async () => {
    await worker.stop();
  });

  test('handles GET request', async () => {
    const response = await worker.fetch('http://localhost/api/health');
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe('ok');
  });
});
```

## Resources

- **Cloudflare Workers Docs**: https://developers.cloudflare.com/workers/
- **Cloudflare Pages Docs**: https://developers.cloudflare.com/pages/
- **Wrangler CLI**: https://developers.cloudflare.com/workers/wrangler/
- **Miniflare**: https://miniflare.dev/
