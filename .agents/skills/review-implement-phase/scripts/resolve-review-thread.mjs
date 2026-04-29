#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';

const EXIT_SUCCESS = 0;
const EXIT_OPERATIONAL = 1;
const EXIT_CLI = 2;

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const result = { help: false, threadNodeId: null };
  if (args.includes('--help')) {
    result.help = true;
    return result;
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg !== '--thread-node-id') {
      throw { code: EXIT_CLI, message: `error: unknown flag "${arg}"` };
    }
    index += 1;
    if (index >= args.length) {
      throw { code: EXIT_CLI, message: 'error: --thread-node-id requires a value' };
    }
    result.threadNodeId = args[index];
  }
  if (!result.threadNodeId) {
    throw { code: EXIT_CLI, message: 'error: --thread-node-id is required' };
  }
  return result;
}

function getHelpText() {
  return [
    'Usage:',
    '  resolve-review-thread.mjs --thread-node-id <NODE_ID>',
    '',
    'Purpose:',
    '  Resolve a pull request review thread by node ID via GitHub GraphQL API.',
  ].join('\n');
}

function run(command, args, input = null) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input: input ?? undefined,
  });
  if (result.error) {
    throw new Error(`error: failed to execute ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`error: ${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`.trim());
  }
  return result.stdout;
}

function assertCommandAvailable(command, installHint) {
  const probe = spawnSync(command, ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    throw new Error(
      `error: required dependency "${command}" is not available. Install ${installHint} and retry.`,
    );
  }
}

function jqRead(jsonText, query) {
  return run('jq', ['-r', query], jsonText).trim();
}

function resolveThread(threadNodeId) {
  const mutation = [
    'mutation($threadId:ID!){',
    '  resolveReviewThread(input:{threadId:$threadId}){',
    '    thread {',
    '      id',
    '      isResolved',
    '    }',
    '  }',
    '}',
  ].join('\n');

  const response = run('gh', ['api', 'graphql', '-f', `query=${mutation}`, '-F', `threadId=${threadNodeId}`]);
  const isResolved = jqRead(response, '.data.resolveReviewThread.thread.isResolved // empty');
  if (isResolved !== 'true') {
    throw new Error(`error: thread was not resolved successfully (isResolved=${isResolved || 'null'})`);
  }

  const resolvedThreadId = jqRead(response, '.data.resolveReviewThread.thread.id // empty');
  return { resolvedThreadId, isResolved: true };
}

async function main() {
  const args = parseCliArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${getHelpText()}\n`);
    process.exit(EXIT_SUCCESS);
  }

  assertCommandAvailable('gh', 'GitHub CLI (`gh`)');
  assertCommandAvailable('jq', '`jq` (for example: `brew install jq`)');

  const result = resolveThread(args.threadNodeId);
  process.stdout.write(
    JSON.stringify({
      ok: true,
      threadNodeId: args.threadNodeId,
      resolvedThreadId: result.resolvedThreadId,
      isResolved: true,
    }) + '\n',
  );
}

const isMain =
  (() => {
    try {
      const invokedScriptPath = process.argv[1] ? realpathSync(resolve(process.argv[1])) : null;
      const currentModulePath = realpathSync(fileURLToPath(import.meta.url));
      return invokedScriptPath !== null && invokedScriptPath === currentModulePath;
    } catch {
      return false;
    }
  })();

if (isMain) {
  main().catch((error) => {
    const code = typeof error?.code === 'number' ? error.code : EXIT_OPERATIONAL;
    const message = error?.message ? String(error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(code);
  });
}
