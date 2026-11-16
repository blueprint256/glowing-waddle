/**
 * Minimal JSON Schema validator for tool arguments (the subset our tool schemas use):
 * type (incl. unions with "null"), properties, required, additionalProperties:false,
 * enum, minLength, maxLength, pattern, minimum, maximum, items, minItems, maxItems.
 * Dependency-free so it can be unit-tested without installing packages.
 */
export type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  default?: unknown;
  format?: string;
};

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  const actual = typeOf(value);
  if (type === 'number') return actual === 'number' || actual === 'integer';
  return actual === type;
}

export function validateArgs(schema: JsonSchema, value: unknown, path = 'arguments'): string[] {
  const errors: string[] = [];

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${path} must be ${types.join(' or ')} (got ${typeOf(value)})`);
      return errors;
    }
  }
  if (value === null) return errors;

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of: ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(schema.minLength === 1 ? `${path} must not be empty` : `${path} must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path} must be at most ${schema.maxLength} characters`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path} has an invalid format${schema.description ? ` (${schema.description})` : ''}`);
    } else if (schema.format === 'date-or-datetime' && Number.isNaN(Date.parse(value))) {
      errors.push(`${path} is not a valid date`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path} must have at least ${schema.minItems} item(s)`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path} must have at most ${schema.maxItems} items`);
    if (schema.items) {
      value.forEach((item, i) => errors.push(...validateArgs(schema.items!, item, `${path}[${i}]`)));
    }
  }

  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of schema.required || []) {
      if (obj[key] === undefined) errors.push(`${path}.${key} is required`);
    }
    for (const [key, val] of Object.entries(obj)) {
      const propSchema = schema.properties?.[key];
      if (!propSchema) {
        if (schema.additionalProperties === false) errors.push(`${path}.${key} is not a recognised field`);
        continue;
      }
      if (val === undefined) continue;
      errors.push(...validateArgs(propSchema, val, `${path}.${key}`));
    }
  }

  return errors;
}
