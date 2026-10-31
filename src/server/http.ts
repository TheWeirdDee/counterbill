import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { UploadRejected } from '@/docs/parse';
import { RunBlocked } from './runs';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryable = false,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = () => new ApiError(404, 'not_found', 'Not found');

export function jsonError(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ code: err.code, message: err.message, retryable: err.retryable, details: err.details }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { code: 'invalid_input', message: 'Some fields are invalid.', retryable: false, details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      { status: 422 },
    );
  }
  if (err instanceof UploadRejected) {
    return NextResponse.json({ code: err.code, message: err.message, retryable: false }, { status: err.code === 'too_large' ? 413 : 422 });
  }
  if (err instanceof RunBlocked) {
    return NextResponse.json({ code: err.code, message: err.message, retryable: err.status === 503 }, { status: err.status });
  }
  console.error('[api] unexpected error:', (err as Error)?.message);
  return NextResponse.json({ code: 'internal_error', message: 'Something went wrong on our side. Try again.', retryable: true }, { status: 500 });
}

/** Wrap a route handler so every failure becomes a typed `{code,message,retryable}` JSON error. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      return jsonError(e);
    }
  };
}

export async function readJson<T>(req: Request, schema: { parse(v: unknown): T }): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, 'invalid_json', 'The request body must be JSON.');
  }
  return schema.parse(body);
}

export function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('x-real-ip') || 'local';
}
