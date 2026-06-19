import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import * as nodeHttp from 'node:http';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as vite from 'vite';
import { attachBridge } from './bridge';
import { generateDefaultPostgresConfig, PLAYGROUND_DIR } from './default-config';
import { findNearestConfig } from './find-config';

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 5273;
const LSP_PATH = '/psl';

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stages a writable schema file under `.playground/` and returns its path.
 *
 * `.playground/` is where the server can resolve both the generated config's
 * `@prisma-next/*` imports and (via walk-up) the config for the opened
 * document. When `sourceFile` points at an existing file, its contents are
 * copied so the playground edits a sandbox copy rather than the user's file;
 * otherwise an empty scratch file is created. The staged file reuses the
 * source's basename (or `scratch.psl`) so the editor tab reads naturally.
 */
async function stageSchema(sourceFile?: string): Promise<string> {
  await mkdir(PLAYGROUND_DIR, { recursive: true });
  const name = sourceFile !== undefined ? basename(sourceFile) : 'scratch.psl';
  const target = resolve(PLAYGROUND_DIR, name);
  if (sourceFile !== undefined && (await fileExists(sourceFile))) {
    await copyFile(sourceFile, target);
  } else if (!(await fileExists(target))) {
    await writeFile(target, '', 'utf8');
  }
  return target;
}

function resolveCliEntry(): string {
  // The bridge spawns the built CLI binary (`dist/cli.js`). That path is not in
  // the package's `exports` map, so resolve the package's main export and derive
  // the sibling `cli.js` from its directory (`dist/exports/index.mjs` ->
  // `dist/cli.js`).
  const mainExport = fileURLToPath(import.meta.resolve('@prisma-next/cli'));
  return resolve(dirname(mainExport), '..', 'cli.js');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const explicitConfigIndex = args.indexOf('--config');
  const explicitConfig = explicitConfigIndex !== -1 ? args[explicitConfigIndex + 1] : undefined;
  const positional = args.filter((a, i) => {
    if (a.startsWith('--')) return false;
    if (i > 0 && args[i - 1] === '--config') return false;
    return true;
  });
  const schemaArg = positional[0];

  // Resolve the schema the editor opens and the config the server will find for
  // it. The language server (post-merge) discovers a document's config by
  // walking up from the document's own path, so the schema must sit at or under
  // a directory that contains a resolvable `prisma-next.config.ts`.
  //
  // The PSL file is optional. Unless the user points us at an existing config
  // (`--config`) — in which case we open the real file in place and let the
  // server discover that project's config — we stage the schema into
  // `.playground/` (whose `@prisma-next/*` imports resolve) and generate a
  // default-postgres config beside it. That is the "without a config, assume
  // default postgres" path, and it covers no-arg, missing-path, and
  // existing-file-without-config uniformly.
  let schemaPath: string;
  let configPath: string;

  const sourceFile =
    schemaArg === undefined
      ? undefined
      : isAbsolute(schemaArg)
        ? schemaArg
        : resolve(process.cwd(), schemaArg);

  if (explicitConfig !== undefined) {
    if (sourceFile === undefined || !(await fileExists(sourceFile))) {
      console.error('--config requires an existing <schema.psl> argument.');
      process.exit(1);
    }
    schemaPath = sourceFile;
    configPath = isAbsolute(explicitConfig)
      ? explicitConfig
      : resolve(process.cwd(), explicitConfig);
    console.log(`Using schema in place: ${schemaPath}`);
    console.log(`Using config (explicit): ${configPath}`);
  } else if (sourceFile !== undefined && (await fileExists(sourceFile))) {
    const discovered = await findNearestConfig(sourceFile);
    if (discovered !== undefined) {
      // The file belongs to a real project; open it in place under its own config.
      schemaPath = sourceFile;
      configPath = discovered;
      console.log(`Using schema in place: ${schemaPath}`);
      console.log(`Using config (discovered): ${configPath}`);
    } else {
      // Existing file, no project config: stage a copy and assume default postgres.
      schemaPath = await stageSchema(sourceFile);
      configPath = await generateDefaultPostgresConfig(schemaPath);
      console.log(
        `No project config found; staged copy under default-postgres config: ${schemaPath}`,
      );
    }
  } else {
    // No file, or a path that does not exist yet: scratch under default postgres.
    schemaPath = await stageSchema(sourceFile);
    configPath = await generateDefaultPostgresConfig(schemaPath);
    const why = sourceFile === undefined ? 'No schema given' : 'Schema not found';
    console.log(`${why}; opening scratch schema: ${schemaPath}`);
  }

  const cliEntry = resolveCliEntry();
  if (!(await fileExists(cliEntry))) {
    console.error(
      `Built CLI not found at ${cliEntry}.\n` +
        'Build it first:  pnpm --filter @prisma-next/cli build',
    );
    process.exit(1);
  }

  const schemaText = await readFile(schemaPath, 'utf8');
  const documentUri = pathToFileURL(schemaPath).toString();
  const rootUri = pathToFileURL(dirname(configPath)).toString();

  // Hand the browser client its runtime values via a generated module (rather
  // than Vite `define`, whose bare-identifier substitution is unreliable in the
  // programmatic dev-server path). The WS URL is relative so the editor and the
  // LSP bridge share this single origin/port.
  const runtimeModule = resolve(PACKAGE_ROOT, 'src/client/runtime.ts');
  await writeFile(
    runtimeModule,
    `// Generated by psl-playground at launch. Do not edit.
export const wsPath = ${JSON.stringify(LSP_PATH)};
export const documentUri = ${JSON.stringify(documentUri)};
export const rootUri = ${JSON.stringify(rootUri)};
export const schemaPath = ${JSON.stringify(schemaPath)};
export const schemaText = ${JSON.stringify(schemaText)};
`,
    'utf8',
  );

  // One HTTP server hosts both the editor (Vite, in middleware mode) and the
  // LSP WebSocket bridge (on LSP_PATH). Vite's HMR WebSocket is bound to the
  // same server via `hmr.server`, so a single port serves everything.
  const httpServer = nodeHttp.createServer();

  const viteServer = await vite.createServer({
    root: PACKAGE_ROOT,
    server: {
      middlewareMode: true,
      hmr: { server: httpServer },
    },
    appType: 'spa',
  });
  httpServer.on('request', viteServer.middlewares);

  const stopBridge = attachBridge(httpServer, { cliEntry, path: LSP_PATH });

  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `Port ${PORT} is already in use — another psl-playground may be running. Stop it and retry.`,
      );
    } else {
      console.error(`Server error: ${error.message}`);
    }
    process.exit(1);
  });

  httpServer.listen(PORT, () => {
    const url = `http://localhost:${PORT}/`;
    console.log(`Playground: ${url}`);
    console.log(`LSP bridge: ws://localhost:${PORT}${LSP_PATH}`);
    console.log('Open the URL above in your browser. Ctrl+C to stop.');
  });

  const shutdown = async (): Promise<void> => {
    stopBridge();
    await viteServer.close();
    httpServer.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
