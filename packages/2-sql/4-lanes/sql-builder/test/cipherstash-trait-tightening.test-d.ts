/**
 * Type-level regression test pinning the cipherstash trait-tightening
 * promise made by AC3 of the `unify-query-operations` project.
 *
 * Before the SQL family registry collapsed `BuiltinFunctions` into the
 * registry-derived `Functions<QC>`, `fns.eq` was parametric over any codec
 * id — `fns.eq(cipherstashCol, cipherstashCol)` typechecked even though the
 * cipherstash codec deliberately opts out of the framework `equality`
 * trait (its `=` semantics aren't byte-stable across encrypts, so the
 * built-in lowering returns wrong results — see
 * `packages/3-extensions/cipherstash/test/equality-trait-removal.test.ts`
 * for the ORM-side narrative). After the collapse, `fns.eq`'s argument
 * constraint is sourced from the family's `EqualityCodecId<CT>`, which
 * resolves to only the CT entries declaring the framework-canonical
 * `equality` trait. Cipherstash isn't in that union, so the sql-builder
 * surface refuses the call at type-check time — symmetric with the ORM
 * accessor's pre-existing rejection of `cipherstashCol.eq(...)`.
 */

import type { CodecExpression } from '@prisma-next/sql-relational-core/expression';
import { test } from 'vitest';
import type { Functions } from '../src/expression';
import type { QueryContext } from '../src/scope';

// Synthetic codec-type map: an `equality`-trait codec (int4) plus a
// cipherstash-shaped codec that intentionally lacks the framework-canonical
// `equality` trait. Mirrors the live cipherstash descriptor's trait
// declaration (`['cipherstash:equality']` — namespaced, so it doesn't
// satisfy the bare `equality` constraint family-sql's `eq` requires).
type TestCodecTypes = {
  readonly 'pg/int4@1': {
    readonly input: number;
    readonly output: number;
    readonly traits: readonly ['equality', 'order', 'numeric'];
  };
  readonly 'cipherstash/string@1': {
    readonly input: string;
    readonly output: string;
    readonly traits: readonly ['cipherstash:equality'];
  };
};

// Minimal `QueryOperationTypes` carrying only the family's `eq` entry —
// the surface this test pins. Equivalent to the contract slot the family
// descriptor contributes via `SqlFamilyQueryOperationTypes<CT>`.
type TestQueryOperationTypes = {
  readonly eq: {
    readonly self: { readonly traits: readonly ['equality'] };
    readonly impl: <
      CodecId extends {
        [K in keyof TestCodecTypes & string]: TestCodecTypes[K] extends {
          readonly traits: infer T;
        }
          ? ['equality'] extends [T extends readonly string[] ? T[number] : never]
            ? K
            : never
          : never;
      }[keyof TestCodecTypes & string],
    >(
      a: CodecExpression<CodecId, boolean, TestCodecTypes> | null,
      b: CodecExpression<CodecId, boolean, TestCodecTypes> | null,
    ) => { readonly returnType: { readonly codecId: 'pg/bool@1'; readonly nullable: false } };
  };
};

type TestQC = QueryContext & {
  readonly codecTypes: TestCodecTypes;
  readonly queryOperationTypes: TestQueryOperationTypes;
};

declare const fns: Functions<TestQC>;
declare const intCol: CodecExpression<'pg/int4@1', false, TestCodecTypes>;
declare const cipherstashCol: CodecExpression<'cipherstash/string@1', false, TestCodecTypes>;

test('fns.eq(intCol, intCol) typechecks — pg/int4@1 carries the framework `equality` trait', () => {
  // No suppression; the call must resolve cleanly. Codec `pg/int4@1`
  // declares `equality` in its traits, so it appears in
  // `EqualityCodecId<TestCodecTypes>` and the generic binds successfully.
  fns.eq(intCol, intCol);
});

test('fns.eq(cipherstashCol, cipherstashCol) fails type-check — cipherstash does not declare framework `equality`', () => {
  // The cipherstash codec advertises only the namespaced
  // `cipherstash:equality` trait, deliberately not the framework-canonical
  // `equality` — see `packages/3-extensions/cipherstash/src/extension-metadata/codec-metadata.ts`.
  // `EqualityCodecId<TestCodecTypes>` therefore omits `cipherstash/string@1`,
  // and `fns.eq`'s `CodecId` generic cannot bind. The `@ts-expect-error`
  // pins the rejection at the type level; if the cipherstash codec ever
  // re-acquired the framework `equality` trait without re-routing its
  // dispatch (the historical wrong-SQL footgun this whole tightening
  // closes — see the ORM-side regression test
  // `packages/3-extensions/cipherstash/test/equality-trait-removal.test.ts`),
  // this directive would go unused and surface the regression loudly.
  // @ts-expect-error cipherstash codec lacks the framework `equality` trait
  fns.eq(cipherstashCol, cipherstashCol);
});
