/**
 * Which Gemini models can YOUR key actually use? Free-tier access differs per account and per model, so do not assume.
 *
 * Lists the Gemini models the installed Mozaik supports and sends each one a one-word request. HTTP 200 = usable on your
 * tier; HTTP 429 with a very long retryDelay = no quota for your tier (do not select it). Costs nothing on the free tier.
 * The key is read from .env and is never printed.
 *
 *   pnpm gemini:models
 */
import 'dotenv/config';
import { supportedModels } from '@mozaik-ai/core';

const key = process.env.GEMINI_API_KEY ?? process.env.gemini_api_key;
if (!key) {
  console.log('GEMINI_API_KEY is not set. Put it in .env (see .env.example) and run again.');
  process.exit(1);
}
const models = supportedModels.filter((m) => m.specification.provider === 'google').map((m) => m.specification.name);
console.log(`Gemini models supported by the installed @mozaik-ai/core: ${models.join(', ')}\n`);
let usable = 0;
for (const name of models) {
  const t0 = Date.now();
  let line;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }], generationConfig: { maxOutputTokens: 16 } }),
    });
    const body = await res.json().catch(() => ({}));
    const retry = (body.error?.details ?? []).find((d) => /RetryInfo/.test(d['@type']))?.retryDelay;
    if (res.ok) {
      usable++;
      line = `usable on your tier (${((Date.now() - t0) / 1000).toFixed(1)} s for a one-word reply)`;
    } else if (res.status === 429) {
      const secs = retry ? parseFloat(retry) : 0;
      line = secs > 3600 ? `NO free-tier quota for this key (HTTP 429, retry in ~${Math.round(secs / 3600)} h): do not select it` : `rate-limited right now (HTTP 429, retry in ${Math.ceil(secs)} s): usable, try again shortly`;
    } else if (res.status === 400 || res.status === 403) {
      line = `rejected (HTTP ${res.status}): ${String(body.error?.message ?? '').replace(key, '<key>').slice(0, 120)}`;
    } else {
      line = `HTTP ${res.status}`;
    }
  } catch (e) {
    line = `network error: ${e.message}`;
  }
  console.log(`${name.padEnd(26)} ${line}`);
}
console.log(usable ? `\nSet MOZAIK_MODEL to one of the usable models.` : `\nNo supported model is usable with this key.`);
