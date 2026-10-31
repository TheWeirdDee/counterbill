import { z } from 'zod';

const STRIP = new Set(['$schema', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'pattern', 'format', 'exclusiveMinimum', 'exclusiveMaximum']);

/**
 * JSON Schema handed to the provider for strict structured output. Length/pattern constraints are removed
 * because providers support different subsets; Zod re-validates every constraint after the model answers.
 */
export function providerJsonSchema(schema: z.ZodType, dialect: 'strict-json-schema' | 'gemini' = 'strict-json-schema'): Record<string, unknown> {
  const base = strictJsonSchema(schema);
  return dialect === 'gemini' ? toGeminiSchema(base) as Record<string, unknown> : base;
}

/**
 * Gemini's `responseSchema` is an OpenAPI-style subset: no `additionalProperties`, and nullability is `nullable: true`
 * rather than `anyOf: [X, {type: "null"}]`. Zod still validates the real output afterwards.
 */
export function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (!node || typeof node !== 'object') return node;
  const o = node as Record<string, unknown>;
  const anyOf = o.anyOf as unknown[] | undefined;
  if (anyOf && anyOf.length === 2) {
    const nonNull = anyOf.filter((x) => !(x && typeof x === 'object' && (x as { type?: string }).type === 'null'));
    if (nonNull.length === 1) return { ...(toGeminiSchema(nonNull[0]) as object), nullable: true };
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (k === 'additionalProperties' || k === '$schema' || k === 'default') continue;
    out[k] = toGeminiSchema(v);
  }
  return out;
}

function strictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: 'draft-7', io: 'output', unrepresentable: 'any' }) as Record<string, unknown>;
  const clean = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(clean);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        if (STRIP.has(k)) continue;
        out[k] = clean(v);
      }
      if (out.type === 'object' && out.properties) {
        out.additionalProperties = false;
        out.required = Object.keys(out.properties as object);
      }
      return out;
    }
    return node;
  };
  return clean(raw) as Record<string, unknown>;
}
