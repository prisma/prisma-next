import type {
  AuthoringEntityContext,
  AuthoringEntityDescriptor,
  AuthoringEntityNamespace,
} from '@prisma-next/framework-components/authoring';
import { instantiateAuthoringEntity } from '@prisma-next/framework-components/authoring';

/**
 * Family-agnostic merge / instantiation scaffolding for pack-bag-driven
 * authoring contributions. The per-namespace shape (`field`, `type`,
 * `entities`) is parameterized by the discriminator key so each
 * namespace can reuse the same extractor + cross-pack merger without
 * re-deriving the template per family.
 *
 * SQL-specific composition (the `field` / `model` / `rel` / `type` core
 * helpers, the SQL index-types merge) lives in the SQL contract-ts
 * package and imports from here.
 */

export type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;

export type AuthoringNamespaceKey = 'field' | 'type' | 'entities';

export type ExtractAuthoringNamespaceFromPack<
  Pack,
  Key extends AuthoringNamespaceKey,
  EmptyNamespace,
> = Pack extends {
  readonly authoring?: { readonly [P in Key]?: infer Namespace };
}
  ? Namespace extends Record<string, unknown>
    ? Namespace
    : EmptyNamespace
  : EmptyNamespace;

export type MergeExtensionAuthoringNamespaces<
  ExtensionPacks,
  Key extends AuthoringNamespaceKey,
  EmptyNamespace = Record<never, never>,
> = ExtensionPacks extends Record<string, unknown>
  ? keyof ExtensionPacks extends never
    ? EmptyNamespace
    : UnionToIntersection<
        {
          [K in keyof ExtensionPacks]: ExtractAuthoringNamespaceFromPack<
            ExtensionPacks[K],
            Key,
            EmptyNamespace
          >;
        }[keyof ExtensionPacks]
      >
  : EmptyNamespace;

/**
 * Entity-helper shape derivation. Mirrors `FieldHelpersFromNamespace` /
 * `TypeHelpersFromNamespace` in the SQL package: leaf descriptors become
 * callable helpers; nested namespaces recurse.
 */
type ExtractFactoryInputAndOutput<Descriptor extends AuthoringEntityDescriptor> =
  Descriptor['output'] extends {
    readonly factory: (input: infer Input, ctx: AuthoringEntityContext) => infer Output;
  }
    ? { input: Input; output: Output }
    : { input: unknown; output: unknown };

export type EntityHelperFunction<Descriptor extends AuthoringEntityDescriptor> =
  ExtractFactoryInputAndOutput<Descriptor> extends { input: infer Input; output: infer Output }
    ? (input: Input) => Output
    : never;

export type EntityHelpersFromNamespace<Namespace> = {
  readonly [K in keyof Namespace]: Namespace[K] extends AuthoringEntityDescriptor
    ? EntityHelperFunction<Namespace[K]>
    : Namespace[K] extends Record<string, unknown>
      ? EntityHelpersFromNamespace<Namespace[K]>
      : never;
};

export interface EntityHelperFactoryOptions {
  readonly ctx: AuthoringEntityContext;
}

/**
 * Walks an entity namespace (after cross-pack merge) and produces the
 * runtime callable surface mirroring its tree shape. Each leaf
 * descriptor becomes a function `(input) => factory(input, ctx)`;
 * nested namespace objects recurse.
 */
export function createEntityHelpersFromNamespace(
  namespace: AuthoringEntityNamespace,
  options: EntityHelperFactoryOptions,
  path: readonly string[] = [],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(namespace)) {
    const currentPath = [...path, key];
    if (isLeafEntityDescriptor(value)) {
      result[key] = createEntityHelper(currentPath.join('.'), value, options);
      continue;
    }
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = createEntityHelpersFromNamespace(
        value as AuthoringEntityNamespace,
        options,
        currentPath,
      );
    }
  }
  return result;
}

function isLeafEntityDescriptor(value: unknown): value is AuthoringEntityDescriptor {
  return (
    typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'entity'
  );
}

function createEntityHelper(
  helperPath: string,
  descriptor: AuthoringEntityDescriptor,
  options: EntityHelperFactoryOptions,
): (...args: readonly unknown[]) => unknown {
  return (...args: readonly unknown[]) =>
    instantiateAuthoringEntity(helperPath, descriptor, args, options.ctx);
}
