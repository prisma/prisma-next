/**
 * Cipherstash cancellation umbrella.
 *
 * Pins the contract for the cipherstash-internal `RUNTIME.ABORTED`
 * envelope wrapping at every async observation point the extension
 * exposes:
 *
 *   - `bulk-encrypt`  — bulk-encrypt middleware`s `sdk.bulkEncrypt` call.
 *   - `decrypt`       — single-cell `EncryptedString#decrypt()` SDK call.
 *   - `decrypt-all`   — `decryptAll` walker`s `sdk.bulkDecrypt` calls.
 *
 * The codec`s `encode` / `decode` paths are deliberately NOT wrapped
 * here; both are synchronous (encode reads `handle.ciphertext`; decode
 * constructs a fresh envelope from `wire` + `ctx.column` + `sdk`). The
 * surrounding async work — the per-cell `Promise.all` race in the
 * framework`s `encodeParams` / `decodeRow` paths — already throws
 * `RUNTIME.ABORTED` with `phase: 'encode'` / `phase: 'decode'` per
 * ADR 207. The cipherstash phases below cover the async work the
 * framework cannot see (bulk SDK calls in `beforeExecute` middleware
 * and post-stream caller-driven `decrypt()` / `decryptAll()` sites).
 *
 * Envelope shape contract: every cipherstash phase wrapping reuses
 * the framework`s `RUNTIME.ABORTED` envelope (`code === 'RUNTIME.ABORTED'`,
 * `category === 'RUNTIME'`, `severity === 'error'`, `details.phase`,
 * `cause`). Only the `phase` string values are cipherstash-specific —
 * the structural shape (and the `runtimeError` envelope-builder
 * behind it) come from the framework. See ADR 207 / 027.
 */

import type { Contract } from '@prisma-next/contract/types';
import { isRuntimeError, RUNTIME_ABORTED } from '@prisma-next/framework-components/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { InsertAst, ParamRef, TableSource } from '@prisma-next/sql-relational-core/ast';
import { createSqlParamRefMutator } from '@prisma-next/sql-relational-core/middleware';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';
import type { SqlMiddlewareContext } from '@prisma-next/sql-runtime';
import { describe, expect, it, vi } from 'vitest';
import { decryptAll } from '../src/execution/decrypt-all';
import {
  EncryptedString,
  type EncryptedStringFromInternalArgs,
  setHandleRoutingKey,
} from '../src/execution/envelope-string';
import type { CipherstashSdk } from '../src/execution/sdk';
import { CIPHERSTASH_STRING_CODEC_ID } from '../src/extension-metadata/constants';
import { bulkEncryptMiddleware } from '../src/middleware/bulk-encrypt';

interface CounterSdk extends CipherstashSdk {
  readonly bulkEncryptCalls: number;
  readonly bulkDecryptCalls: number;
  readonly singleDecryptCalls: number;
}

/**
 * Build an SDK whose async methods never settle until the supplied
 * controller aborts (or the test forcibly resolves them). Used to
 * exercise mid-flight aborts where the wrapping must observe the
 * abort and reject the awaiting caller before the SDK promise
 * resolves — even when the SDK body itself ignores the signal.
 *
 * The default SDK behaviour (no `behaviour` arg) returns a "stuck"
 * promise that only the abort can break; `behaviour: 'instant'`
 * gives a synchronously-resolved promise so the pre-aborted-at-entry
 * tests can run without a real signal handler.
 */
function makeStuckSdk(behaviour: 'stuck' | 'instant' = 'stuck'): CounterSdk {
  let bulkEncryptCalls = 0;
  let bulkDecryptCalls = 0;
  let singleDecryptCalls = 0;
  return {
    get bulkEncryptCalls() {
      return bulkEncryptCalls;
    },
    get bulkDecryptCalls() {
      return bulkDecryptCalls;
    },
    get singleDecryptCalls() {
      return singleDecryptCalls;
    },
    decrypt() {
      singleDecryptCalls++;
      if (behaviour === 'instant') {
        return Promise.resolve('plaintext');
      }
      return new Promise(() => undefined);
    },
    bulkEncrypt(args) {
      bulkEncryptCalls++;
      if (behaviour === 'instant') {
        return Promise.resolve(args.values.map((v) => `ct:${v}`));
      }
      return new Promise(() => undefined);
    },
    bulkDecrypt(args) {
      bulkDecryptCalls++;
      if (behaviour === 'instant') {
        return Promise.resolve(args.ciphertexts.map(() => 'plaintext'));
      }
      return new Promise(() => undefined);
    },
  };
}

function expectAbortedEnvelope(error: unknown, phase: string): void {
  expect(isRuntimeError(error)).toBe(true);
  if (!isRuntimeError(error)) return;
  expect(error.code).toBe(RUNTIME_ABORTED);
  expect(error.category).toBe('RUNTIME');
  expect(error.severity).toBe('error');
  expect(error.details).toEqual({ phase });
}

function makeMiddlewareCtx(signal: AbortSignal | undefined): SqlMiddlewareContext {
  return {
    contract: {} as Contract<SqlStorage>,
    mode: 'strict',
    now: () => Date.now(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    contentHash: async () => 'mock-hash',
    scope: 'runtime',
    planExecutionId: 'test-fixture-plan-execution-id',
    ...(signal === undefined ? {} : { signal }),
  };
}

function buildInsertPlan(envelopes: ReadonlyArray<EncryptedString>): SqlExecutionPlan {
  const params: unknown[] = [];
  const astRows = envelopes.map((envelope) => {
    const ref = ParamRef.of(envelope, { codec: { codecId: CIPHERSTASH_STRING_CODEC_ID } });
    params.push(envelope);
    return { email: ref };
  });
  const ast = new InsertAst(TableSource.named('user'), astRows);
  return {
    sql: `INSERT INTO "user" (email) VALUES ...`,
    params,
    meta: { target: 'postgres', storageHash: 'sha256:test', lane: 'dsl' },
    ast,
  } as SqlExecutionPlan;
}

interface MakeReadEnvelopeArgs {
  readonly plaintext: string;
  readonly table: string;
  readonly column: string;
  readonly sdk: CipherstashSdk;
}

function makeReadEnvelope(args: MakeReadEnvelopeArgs): EncryptedString {
  const fromInternalArgs: EncryptedStringFromInternalArgs = {
    ciphertext: { c: `ct:${args.plaintext}` },
    table: args.table,
    column: args.column,
    sdk: args.sdk,
  };
  return EncryptedString.fromInternal(fromInternalArgs);
}

describe('bulk-encrypt middleware — RUNTIME.ABORTED { phase: "bulk-encrypt" }', () => {
  it('pre-aborted ctx.signal short-circuits before sdk.bulkEncrypt is called', async () => {
    const sdk = makeStuckSdk('stuck');
    const middleware = bulkEncryptMiddleware(sdk);
    const envelope = EncryptedString.from('alice@example.com');
    setHandleRoutingKey(envelope, 'user', 'email');
    const plan = buildInsertPlan([envelope]);
    const params = createSqlParamRefMutator(plan);
    const controller = new AbortController();
    controller.abort(new Error('client gone'));

    const pending = middleware.beforeExecute?.(plan, makeMiddlewareCtx(controller.signal), params);
    if (!pending) throw new Error('beforeExecute is required for this test');
    const error = await pending.then(
      () => {
        throw new Error('expected RUNTIME.ABORTED rejection');
      },
      (err: unknown) => err,
    );

    expectAbortedEnvelope(error, 'bulk-encrypt');
    // The SDK must not have been entered; the pre-check fires before
    // the bulk-encrypt round-trip is scheduled.
    expect(sdk.bulkEncryptCalls).toBe(0);
  });

  it('mid-flight abort surfaces RUNTIME.ABORTED { phase: "bulk-encrypt" } via the race', async () => {
    const sdk = makeStuckSdk('stuck');
    const middleware = bulkEncryptMiddleware(sdk);
    const envelope = EncryptedString.from('alice@example.com');
    setHandleRoutingKey(envelope, 'user', 'email');
    const plan = buildInsertPlan([envelope]);
    const params = createSqlParamRefMutator(plan);
    const controller = new AbortController();

    const pending = middleware.beforeExecute?.(plan, makeMiddlewareCtx(controller.signal), params);
    queueMicrotask(() => controller.abort(new Error('client gone')));

    const error = await pending?.then(
      () => {
        throw new Error('expected RUNTIME.ABORTED rejection');
      },
      (err: unknown) => err,
    );

    expectAbortedEnvelope(error, 'bulk-encrypt');
    // The SDK call was scheduled (counter increments before the
    // underlying promise settles) but never resolved; the wrapping
    // observed the abort and rejected the awaiter.
    expect(sdk.bulkEncryptCalls).toBe(1);
  });
});

describe('EncryptedString.decrypt — RUNTIME.ABORTED { phase: "decrypt" }', () => {
  it('pre-aborted signal short-circuits before sdk.decrypt is called', async () => {
    const sdk = makeStuckSdk('stuck');
    const envelope = makeReadEnvelope({
      plaintext: 'alice@example.com',
      table: 'user',
      column: 'email',
      sdk,
    });
    const controller = new AbortController();
    controller.abort(new Error('client gone'));

    const error = await envelope.decrypt({ signal: controller.signal }).then(
      () => {
        throw new Error('expected RUNTIME.ABORTED rejection');
      },
      (err: unknown) => err,
    );

    expectAbortedEnvelope(error, 'decrypt');
    expect(sdk.singleDecryptCalls).toBe(0);
  });

  it('mid-flight abort surfaces RUNTIME.ABORTED { phase: "decrypt" } via the race', async () => {
    const sdk = makeStuckSdk('stuck');
    const envelope = makeReadEnvelope({
      plaintext: 'alice@example.com',
      table: 'user',
      column: 'email',
      sdk,
    });
    const controller = new AbortController();
    const pending = envelope.decrypt({ signal: controller.signal });
    queueMicrotask(() => controller.abort(new Error('client gone')));

    const error = await pending.then(
      () => {
        throw new Error('expected RUNTIME.ABORTED rejection');
      },
      (err: unknown) => err,
    );

    expectAbortedEnvelope(error, 'decrypt');
    expect(sdk.singleDecryptCalls).toBe(1);
  });

  it('cached-plaintext fast path bypasses signal observation entirely (synchronous return)', async () => {
    // A write-side envelope (or a previously-decrypted read-side
    // envelope) returns its cached plaintext without consulting the
    // SDK; the abort wrapping is therefore irrelevant — even an
    // already-aborted signal must not turn the cached return into
    // a `RUNTIME.ABORTED` rejection. Pins the no-IO short-circuit.
    const envelope = EncryptedString.from('cached');
    const controller = new AbortController();
    controller.abort(new Error('client gone'));
    expect(await envelope.decrypt({ signal: controller.signal })).toBe('cached');
  });
});

describe('decryptAll — RUNTIME.ABORTED { phase: "decrypt-all" }', () => {
  it('pre-aborted signal short-circuits before sdk.bulkDecrypt is called', async () => {
    const sdk = makeStuckSdk('stuck');
    const envelope = makeReadEnvelope({
      plaintext: 'alice@example.com',
      table: 'user',
      column: 'email',
      sdk,
    });
    const controller = new AbortController();
    controller.abort(new Error('client gone'));

    const error = await decryptAll([envelope], { signal: controller.signal }).then(
      () => {
        throw new Error('expected RUNTIME.ABORTED rejection');
      },
      (err: unknown) => err,
    );

    expectAbortedEnvelope(error, 'decrypt-all');
    expect(sdk.bulkDecryptCalls).toBe(0);
  });

  it('mid-flight abort surfaces RUNTIME.ABORTED { phase: "decrypt-all" } via the race', async () => {
    const sdk = makeStuckSdk('stuck');
    const envelope = makeReadEnvelope({
      plaintext: 'alice@example.com',
      table: 'user',
      column: 'email',
      sdk,
    });
    const controller = new AbortController();
    const pending = decryptAll([envelope], { signal: controller.signal });
    queueMicrotask(() => controller.abort(new Error('client gone')));

    const error = await pending.then(
      () => {
        throw new Error('expected RUNTIME.ABORTED rejection');
      },
      (err: unknown) => err,
    );

    expectAbortedEnvelope(error, 'decrypt-all');
    expect(sdk.bulkDecryptCalls).toBe(1);
  });

  it('no-envelope walk is a no-op even when the signal is aborted', async () => {
    // The walker pre-checks signal abort only when there is work to
    // do. A walk that finds zero envelopes returns immediately
    // without observing the signal — symmetric with `decryptAll`'s
    // documented "no SDK call when no envelopes are reachable"
    // contract.
    const controller = new AbortController();
    controller.abort(new Error('client gone'));
    await expect(decryptAll({}, { signal: controller.signal })).resolves.toBeUndefined();
  });
});

describe('cipherstash phase wrappings preserve cause and reuse the framework envelope', () => {
  it('the controller-supplied reason flows through `cause` for every cipherstash phase', async () => {
    // The framework`s `runtimeAborted` carries `signal.reason`
    // verbatim (per ADR 207). Cipherstash`s wrapping reuses the
    // same envelope construction, so the reason must round-trip
    // identically — codec authors / app callers reading
    // `error.cause` see the same shape regardless of which phase
    // observed the abort.
    const reason = new Error('explicit-controller-reason');
    const controller = new AbortController();
    controller.abort(reason);

    // bulk-encrypt
    {
      const sdk = makeStuckSdk('stuck');
      const envelope = EncryptedString.from('alice@example.com');
      setHandleRoutingKey(envelope, 'user', 'email');
      const plan = buildInsertPlan([envelope]);
      const params = createSqlParamRefMutator(plan);
      const pending = bulkEncryptMiddleware(sdk).beforeExecute?.(
        plan,
        makeMiddlewareCtx(controller.signal),
        params,
      );
      if (!pending) throw new Error('beforeExecute is required for this test');
      const error = await pending.then(
        () => {
          throw new Error('expected RUNTIME.ABORTED rejection');
        },
        (err: unknown) => err,
      );
      expect((error as { cause?: unknown }).cause).toBe(reason);
    }

    // decrypt
    {
      const sdk = makeStuckSdk('stuck');
      const envelope = makeReadEnvelope({
        plaintext: 'alice',
        table: 'user',
        column: 'email',
        sdk,
      });
      const error = await envelope.decrypt({ signal: controller.signal }).then(
        () => {
          throw new Error('expected RUNTIME.ABORTED rejection');
        },
        (err: unknown) => err,
      );
      expect((error as { cause?: unknown }).cause).toBe(reason);
    }

    // decrypt-all
    {
      const sdk = makeStuckSdk('stuck');
      const envelope = makeReadEnvelope({
        plaintext: 'alice',
        table: 'user',
        column: 'email',
        sdk,
      });
      const error = await decryptAll([envelope], { signal: controller.signal }).then(
        () => {
          throw new Error('expected RUNTIME.ABORTED rejection');
        },
        (err: unknown) => err,
      );
      expect((error as { cause?: unknown }).cause).toBe(reason);
    }
  });
});
