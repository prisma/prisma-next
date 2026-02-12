import assert from 'node:assert';
import { test } from 'node:test';

import { getTlsGuidanceMessage, isTlsCertError, parseCliArgs } from './apply-review-actions.mjs';

test('parseCliArgs defaults to dry-run text mode', () => {
  const parsed = parseCliArgs(['node', 'script', '--in', 'review-actions.json']);
  assert.deepStrictEqual(parsed, {
    inPath: 'review-actions.json',
    reviewStatePath: null,
    apply: false,
    format: 'text',
    logOutPath: null,
    help: false,
  });
});

test('parseCliArgs supports apply mode with optional flags', () => {
  const parsed = parseCliArgs([
    'node',
    'script',
    '--in',
    'review-actions.json',
    '--review-state',
    'review-state.json',
    '--apply',
    '--format',
    'json',
    '--log-out',
    'apply-log.json',
  ]);
  assert.deepStrictEqual(parsed, {
    inPath: 'review-actions.json',
    reviewStatePath: 'review-state.json',
    apply: true,
    format: 'json',
    logOutPath: 'apply-log.json',
    help: false,
  });
});

test('parseCliArgs validates expected file extensions and format', () => {
  assert.throws(
    () => parseCliArgs(['node', 'script', '--in', 'review-actions.md']),
    (error) => error?.code === 2 && String(error.message).includes('--in file path must end with .json'),
  );
  assert.throws(
    () => parseCliArgs(['node', 'script', '--in', 'review-actions.json', '--format', 'yaml']),
    (error) => error?.code === 2 && String(error.message).includes('--format must be text or json'),
  );
});

test('isTlsCertError detects gh sandbox certificate failures', () => {
  assert.strictEqual(isTlsCertError('x509: OSStatus -26276'), true);
  assert.strictEqual(isTlsCertError('SSL routines:tls_process_server_certificate'), true);
  assert.strictEqual(isTlsCertError('some unrelated error'), false);
});

test('getTlsGuidanceMessage provides fail-fast rerun guidance', () => {
  const guidance = getTlsGuidanceMessage();
  assert.match(guidance, /rerun outside the sandbox/i);
  assert.match(guidance, /do not disable TLS verification/i);
});
