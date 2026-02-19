/**
 * Type-level tests for nullable/default mutual exclusivity.
 *
 * This file is NOT executed as a test - it's checked by the TypeScript compiler.
 * Uncomment the marked lines to verify they produce compile errors.
 */
import type { ColumnTypeDescriptor } from '../src/builder-state';
import { createTable } from '../src/table-builder';

const textColumn: ColumnTypeDescriptor = { codecId: 'test/text@1', nativeType: 'text' };

// VALID: nullable without default
createTable('user').column('email', { type: textColumn, nullable: true });

// VALID: default without nullable (defaults to false)
createTable('user').column('email', {
  type: textColumn,
  default: { kind: 'literal', value: 'foo' },
});

// VALID: explicit nullable: false with default
createTable('user').column('email', {
  type: textColumn,
  nullable: false,
  default: { kind: 'literal', value: 'foo' },
});

// VALID: nullable: false without default
createTable('user').column('email', { type: textColumn, nullable: false });

// INVALID: nullable: true with default - this produces a user-friendly compile error
// Uncomment the line below to see the error message:
// @ts-expect-error
createTable('user').column('email', {
  type: textColumn,
  nullable: true,
  default: { kind: 'literal', value: 'foo' },
});
