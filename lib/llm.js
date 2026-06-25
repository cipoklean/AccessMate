import OpenAI from 'openai';

/**
 * Provider registry — add a new AI vendor here and it's instantly available
 * to the whole app via LLM_PROVIDER. Each provider maps to:
 *   - apiKeyEnv:     the env var that holds its API key
 *   - baseURL:       the OpenAI-compatible endpoint
 *   - model:         the default model id for this provider
 *   - keyLabel:      human-friendly label used in startup error messages
 *   - supportsVision:true if the provider's default model can process images
 *
 * Every provider must expose an OpenAI-compatible /chat/completions endpoint.
 */
export const PROVIDERS = {
  gemini: {
    apiKeyEnv: 'GEMINI_API_KEY',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-2.5-flash',
    keyLabel: 'Google AI Studio (Gemini) API key',
    supportsVision: true,
  },
  openai: {
    apiKeyEnv: 'OPENAI_API_KEY',
    baseURL: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyLabel: 'OpenAI API key',
    supportsVision: true,
  },
  groq: {
    apiKeyEnv: 'GROQ_API_KEY',
    baseURL: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    keyLabel: 'Groq API key',
    supportsVision: false,
  },
};

/** The provider the app is configured to use as primary (falls back to gemini). */
export const activeProvider = process.env.LLM_PROVIDER
  ? PROVIDERS[process.env.LLM_PROVIDER.toLowerCase()]
  : PROVIDERS.gemini;

if (!activeProvider) {
  const valid = Object.keys(PROVIDERS).join(', ');
  throw new Error(`Unknown LLM_PROVIDER "${process.env.LLM_PROVIDER}". Valid options: ${valid}`);
}

/**
 * Build the fallback chain — the primary provider first, then every other
 * configured provider (those with their API key set) in registry order.
 * If no fallback key is configured, the chain is just the primary.
 */
function buildFallbackChain() {
  const chain = [activeProvider];
  for (const provider of Object.values(PROVIDERS)) {
    if (provider === activeProvider) continue;
    if (process.env[provider.apiKeyEnv]) chain.push(provider);
  }
  return chain;
}

export const fallbackChain = buildFallbackChain();

/**
 * Override the default model per deployment via env var (optional).
 * Falls back to the active provider's default.
 */
export const DEFAULT_MODEL = process.env.LLM_MODEL || activeProvider.model;

/**
 * Cache of OpenAI clients keyed by provider name, so we only build each one once.
 */
const clientCache = new Map();
function getClient(provider) {
  let client = clientCache.get(provider);
  if (!client) {
    client = new OpenAI({
      apiKey: process.env[provider.apiKeyEnv],
      baseURL: provider.baseURL,
    });
    clientCache.set(provider, client);
  }
  return client;
}

/**
 * Should we try the next provider on this error?
 * Retriable: rate limits (429), auth (401/403 — key may be bad/rotated),
 * server errors (5xx), and transient network failures.
 */
function isRetriable(err) {
  const status = err?.status || err?.response?.status;
  const code = err?.code;
  if (status === 429 || status === 401 || status === 403) return true;
  if (typeof status === 'number' && status >= 500) return true;
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND') return true;
  return false;
}

/**
 * Run a chat completion with sensible defaults, falling back across providers
 * if the primary fails with a retriable error.
 *
 * userContent can be a plain string (text) or an array (vision: text + image_url).
 * Pass `vision: true` for image requests — text-only providers are skipped.
 *
 * Returns the assistant text, or throws the last error if every provider fails.
 */
export async function chatComplete({
  systemPrompt,
  userContent,
  maxTokens = 400,
  temperature = 0.3,
  timeoutMs = 30000,
  vision = false,
}) {
  const eligible = vision ? fallbackChain.filter((p) => p.supportsVision) : fallbackChain;
  if (eligible.length === 0) {
    throw new Error('No provider available that supports vision requests');
  }

  let lastErr;
  for (const provider of eligible) {
    try {
      const client = getClient(provider);
      const completion = await client.chat.completions.create(
        {
          // Use each provider's own default model — model ids are not portable
          model: vision ? provider.model : process.env.LLM_MODEL || provider.model,
          max_tokens: maxTokens,
          temperature,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
        },
        { timeout: timeoutMs, maxRetries: 1 },
      );
      const content = completion.choices[0]?.message?.content?.trim();
      if (!content) {
        console.warn(`[llm] empty response from ${provider.keyLabel}`);
        return '';
      }
      return content;
    } catch (err) {
      lastErr = err;
      if (!isRetriable(err) || provider === eligible[eligible.length - 1]) {
        // Non-retriable, or we just tried the last eligible provider — give up.
        throw err;
      }
      // Log the fallback so admins have visibility
      console.warn(
        `[llm] ${provider.keyLabel} failed (${err?.status || err?.code || 'unknown'}), trying next provider`,
      );
    }
  }
  throw lastErr;
}

/**
 * Map common LLM SDK errors to user-friendly messages.
 * Never exposes raw error details to end users.
 *
 * @param {Error} err - The caught error
 * @param {{ task?: string, detail?: string }} [options]
 *   task:   one of 'simplify' | 'alt-text' | 'qa' | 'digest' — adds context
 *   detail: extra info appended to the generic fallback (e.g. message count)
 */
export function classifyLlmError(err, options = {}) {
  const status = err?.status || err?.response?.status;
  const code = err?.code;
  const { task, detail } = options;

  if (status === 429) {
    return "I'm getting rate-limited right now — try again in about a minute.";
  }
  if (status === 401 || status === 403) {
    return "There's an auth problem with the AI service. Ping the admin.";
  }
  if (status && status >= 500) {
    return 'The AI service is having a moment. Try again in a few seconds.';
  }
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ENOTFOUND') {
    return "I'm having trouble reaching the AI service. Try again.";
  }

  // Generic fallback — optionally enriched with task context
  const suffix = detail ? ` ${detail}` : '';
  if (task === 'simplify') {
    return `I couldn't summarize that right now.${suffix} The AI service may be temporarily down — try again shortly.`;
  }
  if (task === 'alt-text') {
    return `I couldn't describe that image right now.${suffix} The AI service may be temporarily down — try again shortly.`;
  }
  if (task === 'qa') {
    return `I couldn't answer that right now.${suffix} The AI service may be temporarily down — try again shortly.`;
  }
  if (task === 'digest') {
    return `I couldn't build the digest right now.${suffix} The AI service may be temporarily down — try again shortly.`;
  }
  return `Something went wrong on my end.${suffix} Try again or contact the admin.`;
}

/**
 * Normalize bullet output from LLMs that ignore strict format rules.
 * Splits on `-`, `*`, or `•` markers; rejoins as `- ` per line.
 */
export function normalizeBullets(text) {
  if (!text) return text;
  const parts = text
    .split(/(?:^|\s+)[-*•]\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return text;
  return parts.map((p) => `- ${p}`).join('\n');
}
