import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { MigrationPlanWithAuthoringSurface } from '@prisma-next/framework-components/control';
import type { MigrationMeta } from '@prisma-next/migration-tools/migration';
import { ifDefined } from '@prisma-next/utils/defined';
import type { SqliteOpFactoryCall } from './op-factory-call';
import type { SqlitePlanTargetDetails } from './planner-target-details';
import { renderOps } from './render-ops';
import { renderCallsToTypeScript } from './render-typescript';
import { SqliteMigration } from './sqlite-migration';

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;

export interface SqliteMigrationDestinationInfo {
  readonly storageHash: string;
  readonly profileHash?: string;
}

export class TypeScriptRenderableSqliteMigration
  extends SqliteMigration
  implements MigrationPlanWithAuthoringSurface
{
  readonly #calls: readonly SqliteOpFactoryCall[];
  readonly #meta: MigrationMeta;
  readonly #destination: SqliteMigrationDestinationInfo;

  constructor(
    calls: readonly SqliteOpFactoryCall[],
    meta: MigrationMeta,
    destination?: SqliteMigrationDestinationInfo,
  ) {
    super();
    this.#calls = calls;
    this.#meta = meta;
    this.#destination = destination ?? { storageHash: meta.to };
  }

  override get operations(): readonly Op[] {
    return renderOps(this.#calls);
  }

  override describe(): MigrationMeta {
    return this.#meta;
  }

  override get destination(): SqliteMigrationDestinationInfo {
    return this.#destination;
  }

  renderTypeScript(): string {
    return renderCallsToTypeScript(this.#calls, {
      from: this.#meta.from,
      to: this.#meta.to,
      ...ifDefined('kind', this.#meta.kind),
      ...ifDefined('labels', this.#meta.labels),
    });
  }
}
