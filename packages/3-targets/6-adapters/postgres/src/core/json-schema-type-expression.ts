type JsonSchemaRecord = Record<string, unknown>;

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

function renderUnion(items: readonly unknown[]): string {
  const rendered = items.map((item) => renderTypeScriptTypeFromJsonSchema(item));
  return rendered.join(' | ');
}

function renderObjectType(schema: JsonSchemaRecord): string {
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
    return `Record<string, ${renderTypeScriptTypeFromJsonSchema(additionalProperties)}>`;
  }

  const renderedProperties = keys.map((key) => {
    const valueSchema = (properties as JsonSchemaRecord)[key];
    const optionalMarker = required.has(key) ? '' : '?';
    return `${quotePropertyKey(key)}${optionalMarker}: ${renderTypeScriptTypeFromJsonSchema(valueSchema)}`;
  });

  return `{ ${renderedProperties.join('; ')} }`;
}

function renderArrayType(schema: JsonSchemaRecord): string {
  if (Array.isArray(schema['items'])) {
    return `readonly [${schema['items'].map((item) => renderTypeScriptTypeFromJsonSchema(item)).join(', ')}]`;
  }

  if (schema['items'] !== undefined) {
    const itemType = renderTypeScriptTypeFromJsonSchema(schema['items']);
    const needsParens = itemType.includes(' | ') || itemType.includes(' & ');
    return needsParens ? `(${itemType})[]` : `${itemType}[]`;
  }

  return 'unknown[]';
}

export function renderTypeScriptTypeFromJsonSchema(schema: unknown): string {
  if (!isRecord(schema)) {
    return 'JsonValue';
  }

  if ('const' in schema) {
    return renderLiteral(schema['const']);
  }

  if (Array.isArray(schema['enum'])) {
    return schema['enum'].map((value) => renderLiteral(value)).join(' | ');
  }

  if (Array.isArray(schema['oneOf'])) {
    return renderUnion(schema['oneOf']);
  }

  if (Array.isArray(schema['anyOf'])) {
    return renderUnion(schema['anyOf']);
  }

  if (Array.isArray(schema['allOf'])) {
    return schema['allOf'].map((item) => renderTypeScriptTypeFromJsonSchema(item)).join(' & ');
  }

  if (Array.isArray(schema['type'])) {
    return schema['type']
      .map((item) => renderTypeScriptTypeFromJsonSchema({ ...schema, type: item }))
      .join(' | ');
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
      return renderArrayType(schema);
    case 'object':
      return renderObjectType(schema);
    default:
      break;
  }

  return 'JsonValue';
}
