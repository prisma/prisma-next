import react from '@vitejs/plugin-react-swc';
import { defineConfig, loadEnv } from 'vite';

/**
 * Vite config for the supabase-todos example SPA.
 *
 * # Why a proxy
 *
 * The browser runs on `http://127.0.0.1:5173` (Vite dev server) but
 * the Hono API listens on `http://127.0.0.1:8787` (`pnpm dev:server`).
 * Without a proxy the SPA would have to hit the API on a different
 * origin and we'd need CORS in the Hono server. Instead, the Vite
 * dev proxy forwards `/api/*` from the SPA origin to the Hono server,
 * so the browser sees same-origin requests and CORS is moot. This is
 * the same shape Vite recommends for "frontend + sidecar API server"
 * setups.
 *
 * # Realtime channel — NOT proxied
 *
 * The supabase-js Realtime client opens a WebSocket to
 * `${SUPABASE_URL}/realtime/v1` (default `http://127.0.0.1:54321`),
 * and that connection is direct — it does NOT go through Vite. The
 * proxy only intercepts `/api/*`. This is the only direct-to-Supabase
 * path the SPA has; everything else is mediated by the Hono server +
 * PN scoped runtime.
 *
 * @see projects/supabase-poc/spec.md § Hono server
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const honoPort = env['HONO_PORT'] ?? '8787';

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${honoPort}`,
          changeOrigin: false,
        },
      },
    },
  };
});
