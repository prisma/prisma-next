/**
 * Type-level tests verifying SqlMigration* types extend core migration types.
 *
 * These tests ensure that the SQL family migration types are properly
 * compatible with the core framework migration types, allowing the CLI
 * to use core types while SQL-specific code uses the extended types.
 */

import type { Contract } from '@prisma-next/contract/types';
import type {
  MigrationPlan,
  MigrationPlannerConflict,
  MigrationPlanOperation,
  MigrationRunnerFailure,
  MigrationRunnerSuccessValue,
} from '@prisma-next/framework-components/control';
import type { MigrationPackage } from '@prisma-next/migration-tools/package';
import { expectTypeOf } from 'vitest';
import type {
  ExtensionContractRef,
  ExtensionContractSpace,
  SqlControlExtensionDescriptor,
  SqlMigrationPlan,
  SqlMigrationPlanOperation,
  SqlMigrationRunnerFailure,
  SqlMigrationRunnerSuccessValue,
  SqlPlannerConflict,
} from '../src/core/migrations/types';

// Note: SqlMigrationOperationClass is the same as core MigrationOperationClass (no SQL-specific extension)

// Test that SqlMigrationPlanOperation has the required core fields
expectTypeOf<SqlMigrationPlanOperation<unknown>['id']>().toExtend<MigrationPlanOperation['id']>();
expectTypeOf<SqlMigrationPlanOperation<unknown>['label']>().toExtend<
  MigrationPlanOperation['label']
>();
expectTypeOf<SqlMigrationPlanOperation<unknown>['operationClass']>().toExtend<
  MigrationPlanOperation['operationClass']
>();

// Test that SqlMigrationPlan extends core MigrationPlan
expectTypeOf<SqlMigrationPlan<unknown>>().toExtend<MigrationPlan>();

// Test that SqlPlannerConflict has the required core fields
expectTypeOf<SqlPlannerConflict['kind']>().toExtend<MigrationPlannerConflict['kind']>();
expectTypeOf<SqlPlannerConflict['summary']>().toExtend<MigrationPlannerConflict['summary']>();

// Test that SqlMigrationRunnerSuccessValue has the required core fields
expectTypeOf<SqlMigrationRunnerSuccessValue['operationsPlanned']>().toExtend<
  MigrationRunnerSuccessValue['operationsPlanned']
>();
expectTypeOf<SqlMigrationRunnerSuccessValue['operationsExecuted']>().toExtend<
  MigrationRunnerSuccessValue['operationsExecuted']
>();

// Test that SqlMigrationRunnerFailure has the required core fields
expectTypeOf<SqlMigrationRunnerFailure['code']>().toExtend<MigrationRunnerFailure['code']>();
expectTypeOf<SqlMigrationRunnerFailure['summary']>().toExtend<MigrationRunnerFailure['summary']>();

// Contract-space descriptor surface (project: extension contract spaces).
//
// `contractSpace` is the authoring view a schema-contributing extension
// publishes via its descriptor module. The framework consumes it only at
// authoring time (`migrate`) — apply / verify paths read the user's repo.
// Migration packages are the canonical on-disk shape (`MigrationPackage`)
// from `@prisma-next/migration-tools/package`; the descriptor wires them
// via JSON imports + an `import.meta.url`-derived `dirPath`. The shape
// locks down here so downstream emission, planning, and runner code can
// rely on it.
expectTypeOf<ExtensionContractRef>().toEqualTypeOf<{
  readonly hash: string;
  readonly invariants: readonly string[];
}>();

expectTypeOf<ExtensionContractSpace['migrations']>().toEqualTypeOf<readonly MigrationPackage[]>();

expectTypeOf<ExtensionContractSpace>().toExtend<{
  readonly contractJson: Contract;
  readonly migrations: readonly MigrationPackage[];
  readonly headRef: ExtensionContractRef;
}>();

// `contractSpace` is optional on the descriptor (additive change — existing
// extensions without a contract space continue to typecheck unchanged).
expectTypeOf<SqlControlExtensionDescriptor<'postgres'>['contractSpace']>().toEqualTypeOf<
  ExtensionContractSpace | undefined
>();
