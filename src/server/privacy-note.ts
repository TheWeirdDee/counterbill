/**
 * What to tell a visitor about who processes uploaded documents, derived from this deployment's actual configuration.
 * Nothing here promises retention, training or deletion behaviour that the code cannot enforce on the provider's side.
 */
import { inferenceReadiness, requiredProviderKey } from './config';

export interface ProcessingNote {
  mode: 'live' | 'test' | 'unconfigured';
  provider: string | null;
  model: string | null;
  /** One sentence for FAQ answers and the privacy section of the docs. */
  sentence: string;
}

export function processingNote(): ProcessingNote {
  const r = inferenceReadiness();
  if (!r.ready) {
    return {
      mode: 'unconfigured',
      provider: null,
      model: null,
      sentence: 'No AI model provider is configured on this server right now, so investigations cannot run and no document text is sent anywhere.',
    };
  }
  if (r.mode === 'test') {
    return { mode: 'test', provider: null, model: null, sentence: 'This server is in test mode: a scripted stand-in replaces the language model, so no document text is sent to a provider.' };
  }
  const provider = requiredProviderKey(r.model)?.provider ?? 'the configured provider';
  return {
    mode: 'live',
    provider,
    model: r.model,
    sentence: `When you run an investigation, the text of your documents is sent to the ${provider} API (model ${r.model}) configured for this deployment. Counterbill cannot control how that provider retains or uses content: read the provider’s current terms for the kind of API access this deployment uses before uploading anything sensitive.`,
  };
}
