/**
 * Declarative contribution to the `import` block of a rendered
 * `migration.ts`. Each node in the IR declares which symbols it needs from
 * which modules; the top-level renderer deduplicates across nodes and emits
 * one `import { a, b, c } from "…"` line per module.
 *
 * Package-private. Structural sibling of the Mongo target's
 * `ImportRequirement`; the two will eventually lift to the framework together
 * with `MigrationTsExpression`.
 */
export interface ImportRequirement {
  readonly moduleSpecifier: string;
  readonly symbol: string;
}

/**
 * Internal abstract base class for any IR node that can be emitted as a
 * TypeScript expression inside a rendered `migration.ts` and declare its own
 * import requirements.
 *
 * The top-level renderer (`renderCallsToTypeScript`) walks an array of these
 * polymorphically, concatenates `renderTypeScript()` results, and aggregates
 * `importRequirements()` into a deduplicated import block.
 *
 * Package-private. Structural sibling of the Mongo target's
 * `MigrationTsExpression` — kept identical so cross-target consolidation to
 * the framework is mechanical.
 */
export abstract class MigrationTsExpression {
  abstract renderTypeScript(): string;
  abstract importRequirements(): readonly ImportRequirement[];
}
