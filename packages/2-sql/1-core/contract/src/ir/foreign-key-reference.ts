import { asNamespaceId, type NamespaceId } from '@prisma-next/contract/types';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlNode } from './sql-node';

/**
 * A local reference: the referenced table lives in the same contract-space.
 * `origin` is omitted from JSON when absent, preserving backward-compatible
 * serialization for all existing local FK contracts.
 */
export interface LocalForeignKeyReferenceInput {
  readonly namespaceId: string;
  readonly tableName: string;
  readonly columns: readonly string[];
  readonly origin?: 'local';
  readonly spaceId?: never;
}

/**
 * A cross-space reference: the referenced table lives in a different
 * contract-space identified by `spaceId`. The full coordinate
 * (`namespaceId`, `tableName`, `columns`) remains present so the reference
 * resolves without lexical context.
 */
export interface SpaceForeignKeyReferenceInput {
  readonly namespaceId: string;
  readonly tableName: string;
  readonly columns: readonly string[];
  readonly origin: 'space';
  readonly spaceId: string;
}

export type ForeignKeyReferenceInput =
  | LocalForeignKeyReferenceInput
  | SpaceForeignKeyReferenceInput;

/**
 * SQL Contract IR node for one side (source or target) of a foreign-key
 * declaration. Carries the full coordinate: namespace, table, and columns.
 *
 * The optional `origin` discriminator distinguishes between a local reference
 * (same contract-space, `origin` absent or `'local'`) and a cross-space
 * reference (`origin: 'space'`) that additionally carries a `spaceId`
 * identifying the foreign contract-space.
 *
 * For local references `origin` and `spaceId` are absent from JSON, keeping
 * the serialized shape byte-identical to contracts authored before this
 * discriminator was added. For cross-space references both `origin: 'space'`
 * and `spaceId` appear in JSON so round-trips are lossless.
 *
 * Use `UNBOUND_NAMESPACE_ID` from `@prisma-next/framework-components/ir`
 * as the sentinel `namespaceId` for single-namespace (unbound) references.
 */
export class ForeignKeyReference extends SqlNode {
  readonly namespaceId: NamespaceId;
  readonly tableName: string;
  readonly columns: readonly string[];
  declare readonly origin?: 'local' | 'space';
  declare readonly spaceId?: string;

  constructor(input: ForeignKeyReferenceInput) {
    super();
    this.namespaceId = asNamespaceId(input.namespaceId);
    this.tableName = input.tableName;
    this.columns = input.columns;
    if (input.origin !== undefined) this.origin = input.origin;
    if (input.origin === 'space') this.spaceId = input.spaceId;
    freezeNode(this);
  }
}
