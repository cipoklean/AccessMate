import { downloadSlackFileAsDataUrl } from '../lib/slackHttp.js';
import { chatComplete, classifyLlmError } from '../lib/llm.js';

// ============ PROMPTS ============
const ALT_TEXT_PROMPT = `You write WCAG-compliant alt text for accessibility.

RULES:
- Lead with the most important visual info — no preamble like "This image shows..." or "The image depicts..."
- Match length to image type:
  * Photo / logo / simple UI: 80-150 characters
  * Chart / diagram: 100-180 characters (state the trend + key numbers)
  * Infographic / dense screenshot: up to 250 characters (preserve key text)
- Use plain language. No jargon unless the image is technical.
- Describe what is visible, not what you infer.
- No emoji. No markdown. One paragraph.

EXAMPLES:
"Bar chart showing Q3 revenue up 23% to $4.2M, driven by enterprise tier growth."
"Screenshot of the VS Code editor with a TypeScript file open and 3 unresolved Git conflicts in the sidebar."
"Photo of a woman in a red jacket hiking on a snowy mountain ridge at sunset."`;

const QA_PROMPT = `You are AccessMate, an accessibility assistant in Slack. A user @mentioned you in a thread and asked a question. Use the thread context to answer.

RULES:
- Answer directly in 1-3 sentences. Lead with the answer, not a preamble.
- If the thread doesn't contain enough info, say plainly: "The thread doesn't say."
- Plain language. No jargon. No emoji. No markdown.
- Strip Slack mentions like <@U123> — refer to people as "someone" or by name if context makes it obvious.
- If the question is vague (or empty), summarize the thread in 2-3 short sentences instead.`;

const STANDALONE_REPLY =
  "Hi! Mention me in a thread to answer questions about it, or attach an image and I'll describe it. Try `/accessmate help` for the full menu.";

// ============ HELPERS ============
function formatThread(messages) {
  return messages
    .map((m) => (m.text || '').replace(/<@[UW][A-Z0-9]+(?:\|[^>]+)?>/g, '@someone'))
    .filter(Boolean)
    .join('\n');
}

function extractQuestion(text, botUserId) {
  if (!text) return '';
  return text.replace(new RegExp(`<@${botUserId}(?:\\|[^>]+)?>`, 'g'), '').trim();
}

// ============ ROUTES ============
async function handleVision({ file, client, channel, thread_ts, logger }) {
  const dataUrl = await downloadSlackFileAsDataUrl(file.url_private);
  const altText =
    (await chatComplete({
      systemPrompt: ALT_TEXT_PROMPT,
      userContent: [
        { type: 'text', text: 'Write alt text for this image.' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
      maxTokens: 400,
      temperature: 0.3,
    })) || '(no description generated)';
  logger?.info?.(`[mention/vision] alt text ${altText.length}c`);
  await client.chat.postMessage({ channel, thread_ts, text: `🖼️ ${altText}` });
}

async function handleThreadQA({ question, client, channel, thread_ts, logger }) {
  const replies = await client.conversations.replies({ channel, ts: thread_ts, limit: 50 });
  const threadText = formatThread(replies.messages || []);
  const userTurn = `THREAD:\n${threadText}\n\nQUESTION:\n${question || '(no question — summarize the thread)'}`;
  const answer =
    (await chatComplete({
      systemPrompt: QA_PROMPT,
      userContent: userTurn,
      maxTokens: 400,
      temperature: 0.3,
    })) || '(no answer generated)';
  logger?.info?.(`[mention/qa] ${replies.messages?.length || 0} msgs → ${answer.length}c`);
  await client.chat.postMessage({ channel, thread_ts, text: answer });
}

// ============ REGISTRATION ============
export function registerMentionHandler(app) {
  app.event('app_mention', async ({ event, client, context, logger }) => {
    const channel = event.channel;
    const thread_ts = event.thread_ts || event.ts;
    const botUserId = context.botUserId;
    try {
      // ROUTE 1: image attached → vision
      const imageFile = (event.files || []).find((f) =>
        (f.mimetype || '').startsWith('image/'),
      );
      if (imageFile) {
        await handleVision({ file: imageFile, client, channel, thread_ts, logger });
        return;
      }
      // ROUTE 2: in a thread (it's a reply, not just the parent) → Q&A
      if (event.thread_ts && event.thread_ts !== event.ts) {
        const question = extractQuestion(event.text, botUserId);
        await handleThreadQA({ question, client, channel, thread_ts: event.thread_ts, logger });
        return;
      }
      // ROUTE 3: standalone mention → help message
      await client.chat.postMessage({ channel, thread_ts, text: STANDALONE_REPLY });
    } catch (err) {
      logger?.error?.(`[mention] ${err?.message || err}`);
      try {
        await client.chat.postMessage({
          channel,
          thread_ts,
          text: `Sorry, I hit an error: ${classifyLlmError(err)}`,
        });
      } catch {}
    }
  });
}