import type {
  ExecutionPlan,
  ParamDescriptor,
  PlanMeta,
  PlanRefs,
} from '@prisma-next/contract/types';
import { planInvalid } from '@prisma-next/plan';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  RawFactory,
  RawFunctionOptions,
  RawTemplateFactory,
  RawTemplateOptions,
} from '@prisma-next/sql-relational-core/types';

const RAW_OPTIONS_SENTINEL = Symbol('rawOptions');

type TemplateInvocation = {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly paramDescriptors: ReadonlyArray<ParamDescriptor>;
};

interface RawPlanBuildArgs {
  readonly contract: SqlContract<SqlStorage>;
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly paramDescriptors: ReadonlyArray<ParamDescriptor>;
  readonly options?: RawTemplateOptions;
}

export function createRawFactory(contract: SqlContract<SqlStorage>): RawFactory {
  const factory = ((first: TemplateStringsArray | string, ...rest: unknown[]) => {
    if (isTemplateInvocation(first)) {
      const { values, options } = splitTemplateValues(rest);
      const compiled = compileTemplateToPositional(first, values);
      return buildRawPlan({
        contract,
        sql: compiled.sql,
        params: compiled.params,
        paramDescriptors: compiled.paramDescriptors,
        ...(options ? { options } : {}),
      });
    }

    const text = first;
    const [options] = rest as [RawFunctionOptions | undefined];

    if (!options) {
      throw planInvalid('Function form requires params option');
    }

    if (!Array.isArray(options.params)) {
      throw planInvalid('Function form params must be an array');
    }

    const paramDescriptors = buildSequentialDescriptors(options.params.length);

    return buildRawPlan({
      contract,
      sql: text,
      params: options.params,
      paramDescriptors,
      options,
    });
  }) as RawFactory;

  factory.with = (options: RawTemplateOptions) => {
    return ((strings: TemplateStringsArray, ...values: readonly unknown[]) => {
      const compiled = compileTemplateToPositional(strings, values);
      return buildRawPlan({
        contract,
        sql: compiled.sql,
        params: compiled.params,
        paramDescriptors: compiled.paramDescriptors,
        options,
      });
    }) as RawTemplateFactory;
  };

  return factory;
}

function compileTemplateToPositional(
  strings: TemplateStringsArray,
  values: readonly unknown[],
): TemplateInvocation {
  let sql = '';
  const params: unknown[] = [];
  const paramDescriptors: ParamDescriptor[] = [];

  strings.forEach((part, index) => {
    sql += part;

    if (index < values.length) {
      const value = values[index];
      const placeholderIndex = params.push(value);
      sql += `$${placeholderIndex}`;
      paramDescriptors.push({
        index: placeholderIndex,
        name: `p${placeholderIndex}`,
        source: 'raw',
      });
    }
  });

  return {
    sql,
    params,
    paramDescriptors,
  };
}

function buildRawPlan(args: RawPlanBuildArgs): ExecutionPlan {
  const params = Array.from(args.params);
  const descriptors = args.paramDescriptors.map((descriptor) =>
    Object.freeze({ ...descriptor, source: 'raw' as const }),
  );

  const meta = buildRawMeta({
    contract: args.contract,
    paramDescriptors: descriptors,
    ...(args.options ? { options: args.options } : {}),
  });

  return Object.freeze({
    sql: args.sql,
    params: Object.freeze(params),
    meta,
  });
}

interface RawMetaBuildArgs {
  readonly contract: SqlContract<SqlStorage>;
  readonly paramDescriptors: ReadonlyArray<ParamDescriptor>;
  readonly options?: RawTemplateOptions;
}

function buildRawMeta(args: RawMetaBuildArgs): PlanMeta {
  const { contract, paramDescriptors, options } = args;

  const meta: PlanMeta = {
    target: contract.target,
    targetFamily: contract.targetFamily,
    coreHash: contract.coreHash,
    ...(contract.profileHash !== undefined ? { profileHash: contract.profileHash } : {}),
    lane: 'raw',
    paramDescriptors: Object.freeze([...paramDescriptors]),
    ...(options?.annotations ? { annotations: Object.freeze({ ...options.annotations }) } : {}),
    ...(options?.refs ? { refs: freezeRefs(options.refs) } : {}),
    ...(options?.projection ? { projection: Object.freeze([...options.projection]) } : {}),
  };

  return Object.freeze(meta);
}

function freezeRefs(refs: PlanRefs): PlanRefs {
  return Object.freeze({
    ...(refs.tables ? { tables: Object.freeze([...refs.tables]) } : {}),
    ...(refs.columns
      ? {
          columns: Object.freeze(
            refs.columns.map((col: { table: string; column: string }) => Object.freeze({ ...col })),
          ),
        }
      : {}),
    ...(refs.indexes
      ? {
          indexes: Object.freeze(
            refs.indexes.map(
              (index: { table: string; columns: ReadonlyArray<string>; name?: string }) =>
                Object.freeze({
                  ...index,
                  columns: Object.freeze([...index.columns]),
                }),
            ),
          ),
        }
      : {}),
  });
}

function buildSequentialDescriptors(count: number): ReadonlyArray<ParamDescriptor> {
  return Array.from({ length: count }, (_, idx) =>
    Object.freeze({
      index: idx + 1,
      name: `p${idx + 1}`,
      source: 'raw' as const,
    }),
  );
}

function isTemplateInvocation(value: unknown): value is TemplateStringsArray {
  return Array.isArray(value) && Object.hasOwn(value, 'raw');
}

interface RawTemplateOptionsSentinel {
  readonly [RAW_OPTIONS_SENTINEL]: true;
  readonly value: RawTemplateOptions;
}

export function rawOptions(options: RawTemplateOptions): RawTemplateOptionsSentinel {
  return Object.freeze({
    [RAW_OPTIONS_SENTINEL]: true as const,
    value: options,
  });
}

function splitTemplateValues(values: readonly unknown[]): {
  readonly values: readonly unknown[];
  readonly options?: RawTemplateOptions;
} {
  if (values.length === 0) {
    return { values };
  }

  const last = values[values.length - 1];
  if (!isOptionsSentinel(last)) {
    return { values };
  }

  return {
    values: values.slice(0, values.length - 1),
    options: last.value,
  };
}

function isOptionsSentinel(value: unknown): value is RawTemplateOptionsSentinel {
  return typeof value === 'object' && value !== null && RAW_OPTIONS_SENTINEL in value;
}
