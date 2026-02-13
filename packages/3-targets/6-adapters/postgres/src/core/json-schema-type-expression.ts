type JsonSchemaRecord = Record<string, unknown>;

const MAX_DEPTH = 32;

function isRecord(value: unknown): value is JsonSchemaRecord {
  return typeof value === 'object' && value !== null;
}

function escapeStringLiteral(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function quotePropertyKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : `'${escapeStringLiteral(key)}'`;
}

function renderLiteral(value: unknown): string {
  if (typeof value === 'string') {
    return `'${escapeStringLiteral(value)}'`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  return 'unknown';
}

function renderUnion(items: readonly unknown[], depth: number): string {
  const rendered = items.map((item) => render(item, depth));
  return rendered.join(' | ');
}

function renderObjectType(schema: JsonSchemaRecord, depth: number): string {
  const properties = isRecord(schema['properties']) ? schema['properties'] : {};
  const required = Array.isArray(schema['required'])
    ? new Set(schema['required'].filter((key): key is string => typeof key === 'string'))
    : new Set<string>();
  const keys = Object.keys(properties).sort((left, right) => left.localeCompare(right));

  if (keys.length === 0) {
    const additionalProperties = schema['additionalProperties'];
    if (additionalProperties === true || additionalProperties === undefined) {
      return 'Record<string, unknown>';
    }
    return `Record<string, ${render(additionalProperties, depth)}>`;
  }

  const renderedProperties = keys.map((key) => {
    const valueSchema = (properties as JsonSchemaRecord)[key];
    const optionalMarker = required.has(key) ? '' : '?';
    return `${quotePropertyKey(key)}${optionalMarker}: ${render(valueSchema, depth)}`;
  });

  return `{ ${renderedProperties.join('; ')} }`;
}

function renderArrayType(schema: JsonSchemaRecord, depth: number): string {
  if (Array.isArray(schema['items'])) {
    return `readonly [${schema['items'].map((item) => render(item, depth)).join(', ')}]`;
  }

  if (schema['items'] !== undefined) {
    const itemType = render(schema['items'], depth);
    const needsParens = itemType.includes(' | ') || itemType.includes(' & ');
    return needsParens ? `(${itemType})[]` : `${itemType}[]`;
  }

  return 'unknown[]';
}

function render(schema: unknown, depth: number): string {
  if (depth > MAX_DEPTH || !isRecord(schema)) {
    return 'JsonValue';
  }

  const nextDepth = depth + 1;

  if ('const' in schema) {
    return renderLiteral(schema['const']);
  }

  if (Array.isArray(schema['enum'])) {
    return schema['enum'].map((value) => renderLiteral(value)).join(' | ');
  }

  if (Array.isArray(schema['oneOf'])) {
    return renderUnion(schema['oneOf'], nextDepth);
  }

  if (Array.isArray(schema['anyOf'])) {
    return renderUnion(schema['anyOf'], nextDepth);
  }

  if (Array.isArray(schema['allOf'])) {
    return schema['allOf'].map((item) => render(item, nextDepth)).join(' & ');
  }

  if (Array.isArray(schema['type'])) {
    return schema['type'].map((item) => render({ ...schema, type: item }, nextDepth)).join(' | ');
  }

  switch (schema['type']) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array':
      return renderArrayType(schema, nextDepth);
    case 'object':
      return renderObjectType(schema, nextDepth);
    default:
      break;
  }

  return 'JsonValue';
}

export function renderTypeScriptTypeFromJsonSchema(schema: unknown): string {
  return render(schema, 0);
}
