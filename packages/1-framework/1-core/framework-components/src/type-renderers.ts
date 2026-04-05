/**
 * Context passed to type renderers during contract.d.ts generation.
 */
export interface RenderTypeContext {
  readonly codecTypesName: string;
}

export interface TypeRendererTemplate {
  readonly kind: 'template';
  readonly template: string;
}

export interface TypeRendererFunction {
  readonly kind: 'function';
  readonly render: (params: Record<string, unknown>, ctx: RenderTypeContext) => string;
}

export type TypeRendererString = string;

export type TypeRendererRawFunction = (
  params: Record<string, unknown>,
  ctx: RenderTypeContext,
) => string;

export type TypeRenderer =
  | TypeRendererString
  | TypeRendererRawFunction
  | TypeRendererTemplate
  | TypeRendererFunction;

export interface NormalizedTypeRenderer {
  readonly codecId: string;
  readonly render: (params: Record<string, unknown>, ctx: RenderTypeContext) => string;
}

export function interpolateTypeTemplate(
  template: string,
  params: Record<string, unknown>,
  ctx: RenderTypeContext,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (key === 'CodecTypes') return ctx.codecTypesName;
    const value = params[key];
    if (value === undefined) {
      throw new Error(
        `Missing template parameter "${key}" in template "${template}". ` +
          `Available params: ${Object.keys(params).join(', ') || '(none)'}`,
      );
    }
    return String(value);
  });
}

export function normalizeRenderer(codecId: string, renderer: TypeRenderer): NormalizedTypeRenderer {
  if (typeof renderer === 'string') {
    return {
      codecId,
      render: (params, ctx) => interpolateTypeTemplate(renderer, params, ctx),
    };
  }

  if (typeof renderer === 'function') {
    return { codecId, render: renderer };
  }

  if (renderer.kind === 'function') {
    return { codecId, render: renderer.render };
  }

  const { template } = renderer;
  return {
    codecId,
    render: (params, ctx) => interpolateTypeTemplate(template, params, ctx),
  };
}
