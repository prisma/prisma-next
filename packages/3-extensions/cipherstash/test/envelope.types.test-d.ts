/**
 * Type-shape tests for the `EncryptedString` envelope's public surface.
 *
 * The envelope follows the Rust `secrecy` pattern: the wrapped handle is
 * reachable via the explicit `expose()` method (and `EncryptedStringHandle`
 * is part of the public surface), but no *direct* property accessor —
 * `envelope.plaintext`, `envelope.ciphertext`, `envelope.handle` — exists,
 * so the only way to reach the handle is to ask for it by name.
 *
 * `@ts-expect-error` is permitted in negative type tests per
 * `AGENTS.md § Typesafety rules`.
 */

import type { EncryptedEnvelopePlaceholder } from '../src/execution/envelope-base';
import { EncryptedString, type EncryptedStringHandle } from '../src/exports/runtime';

const envelope = EncryptedString.from('alice@example.com');

// -- Negative: no direct property accessors (forces explicit expose()) ---

// @ts-expect-error — direct `.handle` accessor is not part of the public surface.
envelope.handle;
// @ts-expect-error — direct `.plaintext` accessor is not part of the public surface.
envelope.plaintext;
// @ts-expect-error — direct `.ciphertext` accessor is not part of the public surface.
envelope.ciphertext;

// -- Positive: explicit access via expose() returns the handle type -----

const _expose: () => EncryptedStringHandle = envelope.expose.bind(envelope);

const _decrypt: (opts?: { signal?: AbortSignal }) => Promise<string> =
  envelope.decrypt.bind(envelope);
// `toJSON` returns the per-type placeholder object (resolved AC-ENV4 vs
// AC-ENV5 tension; see envelope-base for the rationale). Pinning the
// shape here catches a regression that would re-flatten it back to a
// bare string and re-introduce the AC-ENV5 mismatch.
const _toJson: () => EncryptedEnvelopePlaceholder = envelope.toJSON.bind(envelope);

void _expose;
void _decrypt;
void _toJson;
