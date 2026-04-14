import { describe, expect, it } from 'vitest';
import { checkMiddlewareCompatibility, type RuntimeMiddleware } from '../src/runtime-middleware';

describe('checkMiddlewareCompatibility', () => {
  it('accepts a generic middleware (no familyId) for any runtime', () => {
    const middleware: RuntimeMiddleware = { name: 'telemetry' };
    expect(() => checkMiddlewareCompatibility(middleware, 'sql')).not.toThrow();
    expect(() => checkMiddlewareCompatibility(middleware, 'mongo')).not.toThrow();
    expect(() => checkMiddlewareCompatibility(middleware, 'sql', 'postgres')).not.toThrow();
  });

  it('accepts a family-matched middleware', () => {
    const middleware: RuntimeMiddleware = { name: 'sql-lints', familyId: 'sql' };
    expect(() => checkMiddlewareCompatibility(middleware, 'sql')).not.toThrow();
  });

  it('rejects a family-mismatched middleware with a clear error', () => {
    const middleware: RuntimeMiddleware = { name: 'sql-lints', familyId: 'sql' };
    expect(() => checkMiddlewareCompatibility(middleware, 'mongo')).toThrow(
      "Middleware 'sql-lints' requires family 'sql' but the runtime is configured for family 'mongo'",
    );
  });

  it('accepts a target-matched middleware', () => {
    const middleware: RuntimeMiddleware = {
      name: 'pg-specific',
      familyId: 'sql',
      targetId: 'postgres',
    };
    expect(() => checkMiddlewareCompatibility(middleware, 'sql', 'postgres')).not.toThrow();
  });

  it('rejects a target-mismatched middleware with a clear error', () => {
    const middleware: RuntimeMiddleware = {
      name: 'pg-specific',
      familyId: 'sql',
      targetId: 'postgres',
    };
    expect(() => checkMiddlewareCompatibility(middleware, 'sql', 'mysql')).toThrow(
      "Middleware 'pg-specific' requires target 'postgres' but the runtime is configured for target 'mysql'",
    );
  });

  it('rejects targetId without familyId', () => {
    const middleware: RuntimeMiddleware = {
      name: 'bad',
      targetId: 'postgres',
    };
    expect(() => checkMiddlewareCompatibility(middleware, 'sql', 'postgres')).toThrow(
      "Middleware 'bad' specifies targetId 'postgres' without familyId",
    );
  });

  it('accepts a target-bound middleware when runtime has no targetId', () => {
    const middleware: RuntimeMiddleware = {
      name: 'pg-specific',
      familyId: 'sql',
      targetId: 'postgres',
    };
    expect(() => checkMiddlewareCompatibility(middleware, 'sql')).not.toThrow();
  });
});
