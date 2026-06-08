export type { AuthoringPslBlockDescriptorNamespace } from '../shared/framework-authoring';
export type {
  PslBlockParam,
  PslBlockParamList,
  PslBlockParamOption,
  PslBlockParamRef,
  PslBlockParamValue,
  PslDiagnosticCode,
  PslExtensionBlock,
  PslExtensionBlockParamList,
  PslExtensionBlockParamOption,
  PslExtensionBlockParamRef,
  PslExtensionBlockParamScalarValue,
  PslExtensionBlockParamValue,
  PslPosition,
  PslSpan,
} from '../shared/psl-extension-block';

import { blindCast } from '@prisma-next/utils/casts';
import type { CodecLookup } from '../shared/codec-types';
import type { AuthoringPslBlockDescriptorNamespace } from '../shared/framework-authoring';
import type { PslDiagnosticCode, PslExtensionBlock, PslSpan } from '../shared/psl-extension-block';

export interface PslDiagnostic {
  readonly code: PslDiagnosticCode;
  readonly message: string;
  readonly sourceId: string;
  readonly span: PslSpan;
}

export interface PslDefaultFunctionValue {
  readonly kind: 'function';
  readonly name: 'autoincrement' | 'now';
}

export interface PslDefaultLiteralValue {
  readonly kind: 'literal';
  readonly value: string | number | boolean;
}

export type PslDefaultValue = PslDefaultFunctionValue | PslDefaultLiteralValue;

export type PslAttributeTarget = 'field' | 'model' | 'enum' | 'namedType';

export interface PslAttributePositionalArgument {
  readonly kind: 'positional';
  readonly value: string;
  readonly span: PslSpan;
}

export interface PslAttributeNamedArgument {
  readonly kind: 'named';
  readonly name: string;
  readonly value: string;
  readonly span: PslSpan;
}

export type PslAttributeArgument = PslAttributePositionalArgument | PslAttributeNamedArgument;

export interface PslTypeConstructorCall {
  readonly kind: 'typeConstructor';
  readonly path: readonly string[];
  readonly args: readonly PslAttributeArgument[];
  readonly span: PslSpan;
}

export interface PslAttribute {
  readonly kind: 'attribute';
  readonly target: PslAttributeTarget;
  readonly name: string;
  readonly args: readonly PslAttributeArgument[];
  readonly span: PslSpan;
}

export type PslReferentialAction = string;

export type PslFieldAttribute = PslAttribute;

export interface PslField {
  readonly kind: 'field';
  readonly name: string;
  /** Unqualified type name, e.g. `"User"` for both `User`, `auth.User`, and `supabase:auth.User`. */
  readonly typeName: string;
  /** Namespace qualifier from a dot-qualified type reference, e.g. `"auth"` for `auth.User` or `supabase:auth.User`. Absent for unqualified types. */
  readonly typeNamespaceId?: string;
  /**
   * Contract-space qualifier from a colon-prefix type reference, e.g. `"supabase"` for
   * `supabase:auth.User` or `supabase:User`. Absent for local (same-space) type references.
   *
   * When present, the field references a model from a different contract space. The namespace
   * (`typeNamespaceId`) and model name (`typeName`) identify the target within that space.
   * Physical table resolution against the extension contract is deferred to the aggregate stage (M3).
   */
  readonly typeContractSpaceId?: string;
  readonly typeConstructor?: PslTypeConstructorCall;
  readonly optional: boolean;
  readonly list: boolean;
  readonly typeRef?: string;
  readonly attributes: readonly PslFieldAttribute[];
  readonly span: PslSpan;
}

export interface PslUniqueConstraint {
  readonly kind: 'unique';
  readonly fields: readonly string[];
  readonly span: PslSpan;
}

export interface PslIndexConstraint {
  readonly kind: 'index';
  readonly fields: readonly string[];
  readonly span: PslSpan;
}

export type PslModelAttribute = PslAttribute;

export interface PslModel {
  readonly kind: 'model';
  readonly name: string;
  readonly fields: readonly PslField[];
  readonly attributes: readonly PslModelAttribute[];
  readonly span: PslSpan;
  /**
   * Optional leading comment line emitted above the `model` keyword by the
   * printer. Producers (e.g. `sqlSchemaIrToPslAst`) attach introspection
   * advisories such as "// WARNING: This table has no primary key in the
   * database" here. The parser leaves this field unset; round-tripping a
   * parsed schema does not re-attach comments.
   */
  readonly comment?: string;
}

export interface PslEnumValue {
  readonly kind: 'enumValue';
  readonly name: string;
  /**
   * Optional storage label for the enum member, captured from a trailing
   * `@map("...")` attribute on the member line. The parser populates this
   * when the source PSL carries an explicit `@map`. Producers (e.g.
   * `sqlSchemaIrToPslAst`) leave it unset; the printer emits `@map(...)`
   * automatically when normalisation would change the printed member name
   * (so an enum value `'in-progress'` becomes `inProgress @map("in-progress")`
   * in PSL, preserving the round-trip).
   */
  readonly mapName?: string;
  readonly span: PslSpan;
}

export interface PslEnum {
  readonly kind: 'enum';
  readonly name: string;
  readonly values: readonly PslEnumValue[];
  readonly attributes: readonly PslAttribute[];
  readonly span: PslSpan;
}

export interface PslCompositeType {
  readonly kind: 'compositeType';
  readonly name: string;
  readonly fields: readonly PslField[];
  readonly attributes: readonly PslAttribute[];
  readonly span: PslSpan;
}

export interface PslNamedTypeDeclaration {
  readonly kind: 'namedType';
  readonly name: string;
  /**
   * Parser invariant: exactly one of `baseType` and `typeConstructor` is set.
   * Expressing this as a discriminated union trips TypeScript narrowing when
   * the declaration flows through helpers that accept the full union.
   */
  readonly baseType?: string;
  readonly typeConstructor?: PslTypeConstructorCall;
  readonly attributes: readonly PslAttribute[];
  readonly span: PslSpan;
}

export interface PslTypesBlock {
  readonly kind: 'types';
  readonly declarations: readonly PslNamedTypeDeclaration[];
  readonly span: PslSpan;
}

/**
 * Name of the synthesised namespace bucket the framework parser uses for
 * top-level declarations that appear outside any `namespace { … }` block.
 * The double-underscore decoration signals that the identifier is parser-
 * synthesised and never appears in user-authored PSL source — writing
 * `namespace __unspecified__ { … }` is a parse error.
 *
 * Distinct from the IR sentinel `__unbound__`: the PSL bucket describes
 * syntactic absence at the parser layer; the IR sentinel describes a late-
 * bound storage slot at the IR layer. Per-target interpreters decide how
 * (or whether) to map the PSL bucket to the IR sentinel.
 */
export const UNSPECIFIED_PSL_NAMESPACE_ID = '__unspecified__';

/**
 * Union over the named entity node types that may appear as values in
 * `PslNamespace.entries`. Each member already carries its own `kind`
 * discriminator and `name`, so the union is self-describing.
 *
 * Built-in kinds: `'model'`, `'enum'`, `'compositeType'`.
 * Extension-contributed kinds: the block's `discriminator` string (e.g.
 * `'policy_select'`), which becomes the entry key in `entries`.
 */
export type PslNamespaceEntry = PslModel | PslEnum | PslCompositeType | PslExtensionBlock;

/**
 * A named namespace block from a PSL document, or the parser's synthesised
 * `__unspecified__` bucket for declarations that appear outside any
 * `namespace { … }` block. Multiple `namespace foo { … }` blocks for the
 * same name across one or more files reopen-merge into a single entry;
 * `span` points at the first opening.
 *
 * ### Canonical shape: `entries`
 *
 * Per ADR 224, `entries` is the single authoritative container for all
 * entity-kind slot maps. Each own-enumerable key is an entity kind in the
 * singular (`'model'`, `'enum'`, `'compositeType'` for built-ins; the block
 * discriminator string for extension-contributed kinds). Each value is a
 * frozen map from entity name to the node instance.
 *
 * Built-in kinds use their PSL keyword as the kind key:
 *
 * ```
 * entries['model']['User']        → PslModel
 * entries['enum']['Role']         → PslEnum
 * entries['compositeType']['Addr'] → PslCompositeType
 * ```
 *
 * Extension-contributed kinds use their descriptor's `discriminator`:
 *
 * ```
 * entries['policy_select']['ReadPosts'] → PslExtensionBlock
 * ```
 *
 * Both the outer `entries` object and each inner per-kind map are frozen at
 * construction, matching the IR's deep-immutability discipline (ADR 224).
 *
 * @see {@link makePslNamespaceEntries} — the factory that builds a frozen
 * `entries` container from the per-kind arrays.
 */
export interface PslNamespace {
  readonly kind: 'namespace';
  readonly name: string;
  /**
   * Canonical ADR 224 `entries` container. Each own-enumerable key is an
   * entity kind (singular, essence-named); each value is a frozen map from
   * entity name to node instance. Both the outer container and each inner map
   * are frozen at construction.
   *
   * This is the single authoritative store. The typed per-kind accessors
   * (`models`, `enums`, `compositeTypes`) derive their values by reading from
   * this container — they are getter properties on the object created by
   * `makePslNamespace`, not stored arrays.
   */
  readonly entries: Readonly<Record<string, Readonly<Record<string, PslNamespaceEntry>>>>;
  /**
   * Typed read path for built-in model declarations in this namespace.
   * Derived getter — reads `Object.values(entries['model'] ?? {})`. Use this
   * in framework code that needs to iterate over models. Do not set this field
   * on a namespace object literal; use `makePslNamespace` instead.
   *
   * Extension-contributed kinds have no typed accessor; reach them via
   * `entries[discriminator]` or the `namespacePslExtensionBlocks` helper.
   */
  readonly models: readonly PslModel[];
  /**
   * Typed read path for built-in enum declarations in this namespace.
   * Derived getter — reads `Object.values(entries['enum'] ?? {})`.
   */
  readonly enums: readonly PslEnum[];
  /**
   * Typed read path for built-in composite-type declarations in this namespace.
   * Derived getter — reads `Object.values(entries['compositeType'] ?? {})`.
   */
  readonly compositeTypes: readonly PslCompositeType[];
  readonly span: PslSpan;
}

/**
 * Builds a frozen `PslNamespace` object whose `models`, `enums`, and
 * `compositeTypes` properties are getter functions that derive their values
 * from `entries` — the single canonical store.
 *
 * This is the only correct way to construct a `PslNamespace`. Never construct
 * a namespace object literal directly; the parallel per-kind array fields must
 * not be stored data.
 *
 * @param init - The four required stored fields: `kind`, `name`, `entries`, `span`.
 */
export function makePslNamespace(init: {
  readonly kind: 'namespace';
  readonly name: string;
  readonly entries: Readonly<Record<string, Readonly<Record<string, PslNamespaceEntry>>>>;
  readonly span: PslSpan;
}): PslNamespace {
  const ns = Object.freeze(
    Object.create(null, {
      kind: { value: init.kind, enumerable: true, writable: false, configurable: false },
      name: { value: init.name, enumerable: true, writable: false, configurable: false },
      entries: { value: init.entries, enumerable: true, writable: false, configurable: false },
      span: { value: init.span, enumerable: true, writable: false, configurable: false },
      models: {
        enumerable: false,
        configurable: false,
        get(): readonly PslModel[] {
          return blindCast<
            readonly PslModel[],
            'entries[model] holds only PslModel by makePslNamespaceEntries construction'
          >(Object.values(init.entries['model'] ?? {}));
        },
      },
      enums: {
        enumerable: false,
        configurable: false,
        get(): readonly PslEnum[] {
          return blindCast<
            readonly PslEnum[],
            'entries[enum] holds only PslEnum by makePslNamespaceEntries construction'
          >(Object.values(init.entries['enum'] ?? {}));
        },
      },
      compositeTypes: {
        enumerable: false,
        configurable: false,
        get(): readonly PslCompositeType[] {
          return blindCast<
            readonly PslCompositeType[],
            'entries[compositeType] holds only PslCompositeType by makePslNamespaceEntries construction'
          >(Object.values(init.entries['compositeType'] ?? {}));
        },
      },
    }),
  );
  return blindCast<
    PslNamespace,
    'Object.create result satisfies PslNamespace: all interface properties set via descriptor construction above'
  >(ns);
}

/**
 * Builds a frozen `entries` container from the per-kind arrays that the
 * parser accumulates. This is the only correct way to build the `entries`
 * field — call it in the parser (or in any other producer) rather than
 * building the object literal by hand.
 *
 * Built-in kinds use their PSL keyword as the key (`'model'`, `'enum'`,
 * `'compositeType'`). Extension-contributed kinds use the block's
 * `kind` discriminator string.
 *
 * Each inner per-kind map is frozen before being added to the container, and
 * the container itself is frozen before being returned.
 */
export function makePslNamespaceEntries(
  models: readonly PslModel[],
  enums: readonly PslEnum[],
  compositeTypes: readonly PslCompositeType[],
  extensionBlocks: readonly PslExtensionBlock[],
): Readonly<Record<string, Readonly<Record<string, PslNamespaceEntry>>>> {
  const container: Record<string, Readonly<Record<string, PslNamespaceEntry>>> = {};

  if (models.length > 0) {
    const map: Record<string, PslModel> = {};
    for (const m of models) {
      map[m.name] = m;
    }
    container['model'] = Object.freeze(map);
  }

  if (enums.length > 0) {
    const map: Record<string, PslEnum> = {};
    for (const e of enums) {
      map[e.name] = e;
    }
    container['enum'] = Object.freeze(map);
  }

  if (compositeTypes.length > 0) {
    const map: Record<string, PslCompositeType> = {};
    for (const ct of compositeTypes) {
      map[ct.name] = ct;
    }
    container['compositeType'] = Object.freeze(map);
  }

  // Extension blocks are grouped by their kind discriminator.
  for (const block of extensionBlocks) {
    const existing = container[block.kind];
    if (existing !== undefined) {
      // Already have entries for this kind — need to unfreeze temporarily.
      // Build a new map by copying the existing frozen entries plus the new one.
      const newMap: Record<string, PslExtensionBlock> = {};
      for (const [k, v] of Object.entries(existing)) {
        newMap[k] = blindCast<
          PslExtensionBlock,
          'extension-block kind maps contain only PslExtensionBlock by makePslNamespaceEntries construction'
        >(v);
      }
      newMap[block.name] = block;
      container[block.kind] = Object.freeze(newMap);
    } else {
      const map: Record<string, PslExtensionBlock> = {};
      map[block.name] = block;
      container[block.kind] = Object.freeze(map);
    }
  }

  return Object.freeze(container);
}

export interface PslDocumentAst {
  readonly kind: 'document';
  readonly sourceId: string;
  readonly namespaces: readonly PslNamespace[];
  readonly types?: PslTypesBlock;
  readonly span: PslSpan;
}

/**
 * Returns all models from every namespace in document order. Convenience
 * for consumers that don't (yet) need namespace-awareness.
 */
export function flatPslModels(ast: PslDocumentAst): readonly PslModel[] {
  return ast.namespaces.flatMap((ns) =>
    blindCast<
      PslModel[],
      'model kind map contains only PslModel by makePslNamespaceEntries construction'
    >(Object.values(ns.entries['model'] ?? {})),
  );
}

/**
 * Returns all enums from every namespace in document order.
 */
export function flatPslEnums(ast: PslDocumentAst): readonly PslEnum[] {
  return ast.namespaces.flatMap((ns) =>
    blindCast<
      PslEnum[],
      'enum kind map contains only PslEnum by makePslNamespaceEntries construction'
    >(Object.values(ns.entries['enum'] ?? {})),
  );
}

/**
 * Returns all composite types from every namespace in document order.
 */
export function flatPslCompositeTypes(ast: PslDocumentAst): readonly PslCompositeType[] {
  return ast.namespaces.flatMap((ns) =>
    blindCast<
      PslCompositeType[],
      'compositeType kind map contains only PslCompositeType by makePslNamespaceEntries construction'
    >(Object.values(ns.entries['compositeType'] ?? {})),
  );
}

/**
 * The set of `entries` kind keys that the framework parser reserves for
 * built-in PSL entity kinds. Any own-enumerable key on `PslNamespace.entries`
 * that is **not** in this set was contributed by an extension-block descriptor.
 *
 * Built-in keys match the PSL keyword used on each block type:
 * `'model'`, `'enum'`, `'compositeType'`.
 */
export const BUILTIN_PSL_KIND_KEYS: ReadonlySet<string> = new Set([
  'model',
  'enum',
  'compositeType',
]);

/**
 * Returns all extension-contributed blocks in the given namespace, in
 * insertion order (the order the parser encountered them in the source).
 *
 * Reads from `namespace.entries`, skipping the three built-in kind keys
 * (`'model'`, `'enum'`, `'compositeType'`). All remaining kind maps contain
 * only `PslExtensionBlock` nodes by construction (see `makePslNamespaceEntries`).
 */
export function namespacePslExtensionBlocks(ns: PslNamespace): readonly PslExtensionBlock[] {
  const result: PslExtensionBlock[] = [];
  for (const [kindKey, kindMap] of Object.entries(ns.entries)) {
    if (BUILTIN_PSL_KIND_KEYS.has(kindKey)) continue;
    for (const entry of Object.values(kindMap)) {
      result.push(
        blindCast<
          PslExtensionBlock,
          'non-builtin kind maps contain only PslExtensionBlock by makePslNamespaceEntries construction'
        >(entry),
      );
    }
  }
  return result;
}

export interface ParsePslDocumentInput {
  readonly schema: string;
  readonly sourceId: string;
  /**
   * Registry of declarative block descriptors, keyed by arbitrary path
   * segments with {@link AuthoringPslBlockDescriptor} leaves. The registry
   * teaches the parser which top-level keywords belong to extension
   * contributions: when the parser encounters an unknown keyword, it looks
   * it up here and, when found, reads the block generically into a
   * {@link PslExtensionBlock} node. Absent or undefined means no extension
   * blocks are registered and any unknown keyword yields
   * `PSL_UNSUPPORTED_TOP_LEVEL_BLOCK`.
   *
   * Contrast with the parsed block nodes themselves, which live in
   * {@link PslNamespace.entries} under their discriminator key (read them with
   * {@link namespacePslExtensionBlocks}); this field holds the registry of
   * descriptors that teach the parser how to read those blocks.
   */
  readonly pslBlockDescriptors?: AuthoringPslBlockDescriptorNamespace;
  /**
   * Codec lookup for validating `value`-kind extension block parameters.
   * When provided alongside `pslBlockDescriptors`, the generic validator runs
   * over every parsed extension block after the full AST is assembled,
   * appending any diagnostics to the parse result. Absent or undefined means
   * no codec validation runs; `ref` resolution still runs when namespace
   * context is available (built from the assembled namespaces).
   */
  readonly codecLookup?: CodecLookup;
}

export interface ParsePslDocumentResult {
  readonly ast: PslDocumentAst;
  readonly diagnostics: readonly PslDiagnostic[];
  readonly ok: boolean;
}
