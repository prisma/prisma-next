import { expectTypeOf, test } from 'vitest';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import type { HasIncludeManyCapabilities } from '../src/types';

// Test contracts with different capability configurations
type ContractWithCapabilities = SqlContract<SqlStorage> & {
  readonly target: 'postgres';
  readonly capabilities: {
    readonly postgres: {
      readonly lateral: true;
      readonly jsonAgg: true;
    };
  };
};

type ContractWithoutCapabilities = SqlContract<SqlStorage> & {
  readonly target: 'postgres';
  readonly capabilities: {
    readonly postgres?: {
      readonly lateral?: false;
      readonly jsonAgg?: false;
    };
  };
};

type ContractWithPartialCapabilities = SqlContract<SqlStorage> & {
  readonly target: 'postgres';
  readonly capabilities: {
    readonly postgres: {
      readonly lateral: true;
      readonly jsonAgg?: false;
    };
  };
};

type ContractWithoutCapabilitiesField = SqlContract<SqlStorage> & {
  readonly target: 'postgres';
  readonly capabilities?: never;
};

test('HasIncludeManyCapabilities correctly identifies contracts with capabilities', () => {
  type Result = HasIncludeManyCapabilities<ContractWithCapabilities>;
  expectTypeOf<Result>().toEqualTypeOf<true>();
});

test('HasIncludeManyCapabilities rejects contracts without capabilities', () => {
  type Result = HasIncludeManyCapabilities<ContractWithoutCapabilities>;
  expectTypeOf<Result>().toEqualTypeOf<false>();
});

test('HasIncludeManyCapabilities rejects contracts with partial capabilities', () => {
  type Result = HasIncludeManyCapabilities<ContractWithPartialCapabilities>;
  expectTypeOf<Result>().toEqualTypeOf<false>();
});

test('HasIncludeManyCapabilities rejects contracts without capabilities field', () => {
  type Result = HasIncludeManyCapabilities<ContractWithoutCapabilitiesField>;
  expectTypeOf<Result>().toEqualTypeOf<false>();
});

test('HasIncludeManyCapabilities handles optional capabilities', () => {
  type ContractWithOptionalCapabilities = SqlContract<SqlStorage> & {
    readonly target: 'postgres';
    readonly capabilities?: {
      readonly postgres?: {
        readonly lateral?: true;
        readonly jsonAgg?: true;
      };
    };
  };

  type Result = HasIncludeManyCapabilities<ContractWithOptionalCapabilities>;
  expectTypeOf<Result>().toEqualTypeOf<false>();
});

test('HasIncludeManyCapabilities requires both capabilities to be true', () => {
  type ContractWithOnlyLateral = SqlContract<SqlStorage> & {
    readonly target: 'postgres';
    readonly capabilities: {
      readonly postgres: {
        readonly lateral: true;
        readonly jsonAgg?: false;
      };
    };
  };

  type ContractWithOnlyJsonAgg = SqlContract<SqlStorage> & {
    readonly target: 'postgres';
    readonly capabilities: {
      readonly postgres: {
        readonly lateral?: false;
        readonly jsonAgg: true;
      };
    };
  };

  type Result1 = HasIncludeManyCapabilities<ContractWithOnlyLateral>;
  type Result2 = HasIncludeManyCapabilities<ContractWithOnlyJsonAgg>;

  expectTypeOf<Result1>().toEqualTypeOf<false>();
  expectTypeOf<Result2>().toEqualTypeOf<false>();
});

// Type tests for includeMany result types
test('ResultType yields Array<ChildShape> for includeMany', () => {
  // This test will be expanded when we implement type inference
  // For now, just verify the type structure exists
  type _Test = true;
  expectTypeOf<_Test>().toEqualTypeOf<true>();
});

test('Array element types match child projection types', () => {
  // This test will be expanded when we implement type inference
  type _Test = true;
  expectTypeOf<_Test>().toEqualTypeOf<true>();
});

test('Empty array type when no children', () => {
  // This test will be expanded when we implement type inference
  type _Test = true;
  expectTypeOf<_Test>().toEqualTypeOf<true>();
});

