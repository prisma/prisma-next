import type { ScalarFieldBuilder } from '@prisma-next/sql-contract-ts/contract-builder';
import type { RlsPolicyOperation } from '@prisma-next/target-postgres/types';

/**
 * Structural shape of the model handles the RLS helpers accept: any named
 * `model(...)` builder from the contract DSL, including cross-space
 * `extensionModel` handles. Helpers capture the handle by reference; nothing
 * is read from it until `defineContract` lowers the entities list.
 */
export interface RlsTargetModel {
  readonly stageOne: {
    readonly modelName?: string;
    readonly fields: Record<string, ScalarFieldBuilder>;
  };
}

/** Context passed to a function-form predicate when the contract is lowered. */
export interface RlsPredicateContext {
  /** Returns the qualified identifier (`"schema"."table"`) for a model handle. */
  readonly ref: (model: RlsTargetModel) => string;
}

/**
 * A policy predicate: opaque SQL, either a literal string or a function of
 * {@link RlsPredicateContext} evaluated once at contract-build time. The
 * function form is stored on the handle, never invoked at authoring time.
 */
export type RlsPredicate = string | ((ctx: RlsPredicateContext) => string);

/**
 * Role handle produced by {@link role}. Usable as a reference in a policy's
 * `roles` list and as a declaration in the `entities` list (which lowers it
 * to a `PostgresRole` entity).
 */
export interface RlsRoleHandle<Name extends string = string> {
  readonly entityKind: 'role';
  readonly name: Name;
}

/** Enablement handle produced by {@link rlsEnabled}. */
export interface RlsEnablementHandle {
  readonly entityKind: 'rls';
  readonly model: RlsTargetModel;
}

/**
 * Policy handle produced by the five `policy*` helpers. An inert value
 * capturing the authoring inputs; wire-name hashing and table-name resolution
 * happen when the handle is lowered by `defineContract`.
 */
export interface RlsPolicyHandle<Operation extends RlsPolicyOperation = RlsPolicyOperation> {
  readonly entityKind: 'policy';
  readonly operation: Operation;
  /** The policy name prefix (PSL's block name); the wire name appends a content hash. */
  readonly name: string;
  readonly model: RlsTargetModel;
  readonly roles: readonly RlsRoleHandle[];
  readonly using?: RlsPredicate;
  readonly withCheck?: RlsPredicate;
}

interface RlsPolicyDescriptorBase {
  /** The policy name prefix (PSL's block name); the wire name appends a content hash. */
  readonly name: string;
  readonly roles: readonly RlsRoleHandle[];
}

/** Descriptor for the USING-only operations: SELECT and DELETE. */
export interface RlsUsingPolicyDescriptor extends RlsPolicyDescriptorBase {
  readonly using: RlsPredicate;
}

/** Descriptor for the WITH CHECK-only operation: INSERT. */
export interface RlsWithCheckPolicyDescriptor extends RlsPolicyDescriptorBase {
  readonly withCheck: RlsPredicate;
}

/** Descriptor for the operations taking both predicates: UPDATE and ALL. */
export interface RlsUsingWithCheckPolicyDescriptor extends RlsPolicyDescriptorBase {
  readonly using: RlsPredicate;
  readonly withCheck: RlsPredicate;
}

function assertNonEmptyName(helper: string, name: string): void {
  if (name.trim().length === 0) {
    throw new Error(`${helper}: name must be a non-empty string.`);
  }
}

function buildPolicyHandle<Operation extends RlsPolicyOperation>(
  operation: Operation,
  model: RlsTargetModel,
  descriptor: RlsPolicyDescriptorBase & {
    readonly using?: RlsPredicate;
    readonly withCheck?: RlsPredicate;
  },
): RlsPolicyHandle<Operation> {
  assertNonEmptyName(`policy ${operation}("${descriptor.name}")`, descriptor.name);
  return Object.freeze({
    entityKind: 'policy' as const,
    operation,
    name: descriptor.name,
    model,
    roles: Object.freeze([...descriptor.roles]),
    ...(descriptor.using !== undefined ? { using: descriptor.using } : {}),
    ...(descriptor.withCheck !== undefined ? { withCheck: descriptor.withCheck } : {}),
  });
}

/**
 * Declares a Postgres role by name, mirroring PSL's bare role identifiers.
 * Returns an inert handle: referenced in a policy's `roles` it contributes
 * the bare name; placed in the `entities` list it declares the role
 * (`entries.role`), making it subject to the existence verify.
 */
export function role<const Name extends string>(name: Name): RlsRoleHandle<Name> {
  assertNonEmptyName(`role("${name}")`, name);
  return Object.freeze({ entityKind: 'role' as const, name });
}

/**
 * Marks a model's table RLS-controlled, mirroring PSL's `@@rls`. The
 * enablement marker (never the policy set) drives `ENABLE`/`DISABLE ROW
 * LEVEL SECURITY` planning.
 */
export function rlsEnabled(model: RlsTargetModel): RlsEnablementHandle {
  return Object.freeze({ entityKind: 'rls' as const, model });
}

/** Authors a `FOR SELECT` policy (PSL `policy_select`): row visibility via `using`. */
export function policySelect(
  model: RlsTargetModel,
  descriptor: RlsUsingPolicyDescriptor,
): RlsPolicyHandle<'select'> {
  return buildPolicyHandle('select', model, descriptor);
}

/** Authors a `FOR INSERT` policy (PSL `policy_insert`): new-row validation via `withCheck`. */
export function policyInsert(
  model: RlsTargetModel,
  descriptor: RlsWithCheckPolicyDescriptor,
): RlsPolicyHandle<'insert'> {
  return buildPolicyHandle('insert', model, descriptor);
}

/** Authors a `FOR UPDATE` policy (PSL `policy_update`): takes `using` and `withCheck`. */
export function policyUpdate(
  model: RlsTargetModel,
  descriptor: RlsUsingWithCheckPolicyDescriptor,
): RlsPolicyHandle<'update'> {
  return buildPolicyHandle('update', model, descriptor);
}

/** Authors a `FOR DELETE` policy (PSL `policy_delete`): row eligibility via `using`. */
export function policyDelete(
  model: RlsTargetModel,
  descriptor: RlsUsingPolicyDescriptor,
): RlsPolicyHandle<'delete'> {
  return buildPolicyHandle('delete', model, descriptor);
}

/** Authors a `FOR ALL` policy (PSL `policy_all`): takes `using` and `withCheck`. */
export function policyAll(
  model: RlsTargetModel,
  descriptor: RlsUsingWithCheckPolicyDescriptor,
): RlsPolicyHandle<'all'> {
  return buildPolicyHandle('all', model, descriptor);
}
