/**
 * Mozaik function tools. They are deterministic and case-agnostic (no data access), so a model can check
 * arithmetic with the same code that produces the stored calculations. Results are strings; nothing is rounded early.
 */
import type { Tool } from '@mozaik-ai/core';
import { CalculationError, chargeFor, decimalToString, packageCbm } from '@/domain/calculations';

export const calculateCbmTool: Tool = {
  type: 'function',
  name: 'calculate_cbm',
  description: 'Volume in cubic metres (CBM) of identical packages from their dimensions: length × width × height ÷ 1,000,000 for centimetres, times count.',
  parameters: {
    type: 'object',
    properties: {
      length: { type: 'string' },
      width: { type: 'string' },
      height: { type: 'string' },
      unit: { type: 'string', description: 'cm, m, mm, in or ft' },
      count: { type: 'integer' },
    },
    required: ['length', 'width', 'height', 'unit', 'count'],
    additionalProperties: false,
  },
  strict: true,
  invoke: async (args: { length: string; width: string; height: string; unit: string; count: number }) => {
    try {
      return { cbm: decimalToString(packageCbm(args)) };
    } catch (e) {
      return { error: e instanceof CalculationError ? e.message : 'calculation failed' };
    }
  },
};

export const calculateChargeTool: Tool = {
  type: 'function',
  name: 'calculate_charge',
  description: 'Charge for a volume at a rate per CBM (volume × rate). Returns an exact decimal string; it is a comparison, never an amount owed.',
  parameters: {
    type: 'object',
    properties: { volumeCbm: { type: 'string' }, ratePerCbm: { type: 'string' } },
    required: ['volumeCbm', 'ratePerCbm'],
    additionalProperties: false,
  },
  strict: true,
  invoke: async (args: { volumeCbm: string; ratePerCbm: string }) => {
    try {
      return { charge: decimalToString(chargeFor(args.volumeCbm, args.ratePerCbm)) };
    } catch (e) {
      return { error: e instanceof CalculationError ? e.message : 'calculation failed' };
    }
  },
};
