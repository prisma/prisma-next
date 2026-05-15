import {
  freezeNode,
  NamespaceBase,
  UNSPECIFIED_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';

/**
 * Family-layer placeholder for the SQL unspecified-namespace singleton.
 *
 * SQL contracts honour the framework `Storage.namespaces` invariant from
 * the moment they appear in the IR. Today `SqlStorage` is family-shared
 * (Postgres + SQLite consume the same class); a per-target namespace
 * concretion (`PostgresSchema.unspecified`, `SqliteUnspecifiedDatabase.instance`)
 * earns its existence when each target's namespace shape lands. Until
 * then the family ships a single placeholder singleton so the JSON
 * envelope and runtime walk are honest at every layer.
 *
 * The `kind` discriminator is installed as a non-enumerable own property
 * so the JSON envelope reads `{ "id": "__unspecified__" }` — symmetric
 * with the family-level non-enumerable `kind` on `SqlNode` and bounded
 * to the minimum data the framework `Namespace` interface promises.
 */
export class SqlUnspecifiedNamespace extends NamespaceBase {
  static readonly instance: SqlUnspecifiedNamespace = new SqlUnspecifiedNamespace();

  readonly id = UNSPECIFIED_NAMESPACE_ID;
  declare readonly kind?: string;

  private constructor() {
    super();
    Object.defineProperty(this, 'kind', {
      value: 'sql-namespace',
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }
}
