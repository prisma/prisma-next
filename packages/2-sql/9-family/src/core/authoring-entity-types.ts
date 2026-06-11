import type { JsonValue } from '@prisma-next/contract/types';
import type {
  AuthoringEntityContext,
  AuthoringEntityTypeDescriptor,
  AuthoringEntityTypeNamespace,
  AuthoringPslBlockDescriptorNamespace,
  PslExtensionBlock,
} from '@prisma-next/framework-components/authoring';
import { type EnumTypeHandle, enumType } from '@prisma-next/sql-contract-ts/contract-builder';
import { blindCast } from '@prisma-next/utils/casts';

function parseQuotedString(raw: string): string | undefined {
  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    return raw.slice(1, -1);
  }
  return undefined;
}

export const sqlFamilyEnum2EntityDescriptor = {
  kind: 'entity' as const,
  discriminator: 'enum2',
  output: {
    factory: (
      block: PslExtensionBlock,
      ctx: AuthoringEntityContext,
    ): EnumTypeHandle | undefined => {
      const sourceId = ctx.sourceId ?? 'unknown';
      const diagnostics = ctx.diagnostics;

      const typeAttr = block.blockAttributes.find((a) => a.name === 'type');
      if (!typeAttr) {
        diagnostics?.push({
          code: 'PSL_ENUM2_MISSING_TYPE',
          message: `enum2 "${block.name}" is missing a @@type("codecId") attribute`,
          sourceId,
          span: block.span,
        });
        return undefined;
      }

      const rawCodecArg = typeAttr.args[0]?.value;
      const codecId = rawCodecArg !== undefined ? parseQuotedString(rawCodecArg) : undefined;
      if (!codecId) {
        diagnostics?.push({
          code: 'PSL_ENUM2_MISSING_TYPE',
          message: `enum2 "${block.name}" @@type attribute must have a quoted codec id argument`,
          sourceId,
          span: typeAttr.span,
        });
        return undefined;
      }

      const nativeType = ctx.codecLookup?.targetTypesFor(codecId)?.[0];
      if (nativeType === undefined) {
        const typeArgSpan = typeAttr.args[0]?.span ?? typeAttr.span;
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum2 "${block.name}" @@type references unknown codec "${codecId}"`,
          sourceId,
          span: typeArgSpan,
        });
        return undefined;
      }

      const codec = ctx.codecLookup?.get(codecId);
      if (codec === undefined) {
        const typeArgSpan = typeAttr.args[0]?.span ?? typeAttr.span;
        diagnostics?.push({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum2 "${block.name}" @@type codec "${codecId}" resolves in targetTypesFor but is absent from codecLookup.get`,
          sourceId,
          span: typeArgSpan,
        });
        return undefined;
      }

      const seenValues = new Set<string>();
      const members: { name: string; value: unknown }[] = [];
      let memberError = false;

      for (const [memberName, paramValue] of Object.entries(block.parameters)) {
        let value: unknown;
        if (paramValue.kind === 'bare') {
          try {
            value = codec.decodeJson(memberName);
          } catch {
            diagnostics?.push({
              code: 'PSL_ENUM2_BARE_MEMBER_NON_STRING_CODEC',
              message: `enum2 "${block.name}" member "${memberName}" has no value and codec "${codecId}" does not accept a bare name as input`,
              sourceId,
              span: paramValue.span,
            });
            memberError = true;
            continue;
          }
        } else if (paramValue.kind === 'value') {
          let jsonValue: unknown;
          try {
            jsonValue = JSON.parse(paramValue.raw);
          } catch {
            diagnostics?.push({
              code: 'PSL_EXTENSION_INVALID_VALUE',
              message: `enum2 "${block.name}" member "${memberName}" value "${paramValue.raw}" is not valid JSON`,
              sourceId,
              span: paramValue.span,
            });
            memberError = true;
            continue;
          }
          try {
            value = codec.decodeJson(
              blindCast<JsonValue, 'JSON.parse returns a JsonValue-compatible value'>(jsonValue),
            );
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            diagnostics?.push({
              code: 'PSL_EXTENSION_INVALID_VALUE',
              message: `enum2 "${block.name}" member "${memberName}" was rejected by codec "${codecId}": ${reason}`,
              sourceId,
              span: paramValue.span,
            });
            memberError = true;
            continue;
          }
        } else {
          continue;
        }

        const valueKey = String(value);
        if (seenValues.has(valueKey)) {
          diagnostics?.push({
            code: 'PSL_ENUM2_DUPLICATE_MEMBER_VALUE',
            message: `enum2 "${block.name}": duplicate member value "${valueKey}"`,
            sourceId,
            span: paramValue.span,
          });
          memberError = true;
          continue;
        }
        seenValues.add(valueKey);
        members.push({ name: memberName, value });
      }

      if (memberError) return undefined;

      if (members.length === 0) {
        diagnostics?.push({
          code: 'PSL_ENUM2_MISSING_TYPE',
          message: `enum2 "${block.name}" must have at least one member`,
          sourceId,
          span: block.span,
        });
        return undefined;
      }

      return enumType(
        block.name,
        { codecId, nativeType },
        ...members.map((m) => ({ name: m.name, value: m.value })),
      );
    },
  },
} satisfies AuthoringEntityTypeDescriptor;

export const sqlFamilyEntityTypes: AuthoringEntityTypeNamespace = {
  enum2: sqlFamilyEnum2EntityDescriptor,
};

export const sqlFamilyPslBlockDescriptors = {
  enum2: {
    kind: 'pslBlock',
    keyword: 'enum2',
    discriminator: 'enum2',
    name: { required: true },
    parameters: {},
    variadicParameters: true,
  },
} as const satisfies AuthoringPslBlockDescriptorNamespace;
