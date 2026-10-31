import { z } from 'zod';

const STRIP = new Set(['$schema', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minimum', 'maximum', 'pattern', 'format', 'exclusiveMinimum', 'exclusiveMaximum']);

/**
 * JSON Schema handed to the provider for strict structured output. Length/pattern constraints are removed
 * because providers support different subsets; Zod re-validates every constraint after the model answers.
 */
export function providerJsonSchema(schema: z.ZodType): Record<string, unknown> {
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
