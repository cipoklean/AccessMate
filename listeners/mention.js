import OpenAI from 'openai';
import https from 'node:https';

const slackHttpsAgent = new https.Agent({
  keepAlive: true,
  maxVersion: 'TLSv1.2',
  minVersion: 'TLSv1.2',
});

const gemini = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});

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

async function downloadSlackFile(url) {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      'User-Agent': 'curl/8.18.0',
      Connection: 'close',
    },
    // @ts-ignore — undici accepts agent
    agent: slackHttpsAgent,
  });
  if (!res.ok) throw new Error(`Slack file fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get('content-type') || 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// ============ ROUTES ============

async function handleVision({ file, client, channel, thread_ts, logger }) {
  const dataUrl = await downloadSlackFile(file.url_private);
  const completion = await gemini.chat.completions.create(
    {
      model: 'gemini-3.1-flash-lite',
      max_tokens: 400,
      temperature: 0.3,
      messages: [
        { role: 'system', content: ALT_TEXT_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Write alt text for this image.' },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    },
    { timeout: 30000, maxRetries: 1 },
  );
  const altText = completion.choices[0]?.message?.content?.trim() || '(no description generated)';
  logger?.info?.(`[mention/vision] alt text ${altText.length}c`);
  await client.chat.postMessage({ channel, thread_ts, text: `🖼️ ${altText}` });
}

async function handleThreadQA({ question, client, channel, thread_ts, logger }) {
  const replies = await client.conversations.replies({ channel, ts: thread_ts, limit: 50 });
  const threadText = formatThread(replies.messages || []);
  const userTurn = `THREAD:\n${threadText}\n\nQUESTION:\n${question || '(no question — summarize the thread)'}`;
  const completion = await gemini.chat.completions.create(
    {
      model: 'gemini-3.1-flash-lite',
      max_tokens: 400,
      temperature: 0.3,
      messages: [
        { role: 'system', content: QA_PROMPT },
        { role: 'user', content: userTurn },
      ],
    },
    { timeout: 30000, maxRetries: 1 },
  );
  const answer = completion.choices[0]?.message?.content?.trim() || '(no answer generated)';
  logger?.info?.(`[mention/qa] ${replies.messages?.length || 0} msgs → ${answer.length}c`);
  await client.chat.postMessage({ channel, thread_ts, text: answer });
}

// ============ REGISTRATION ============

export function registerMentionHandler(app) {
  app.event('app_mention', async ({ event, client, context, logger }) => {
    const channel = event.channel;
    const thread_ts = event.thread_ts || event.ts; // reply in-thread; start one if standalone
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
          text: `Sorry, I hit an error: ${err?.message || 'unknown'}`,
        });
      } catch {}
    }
  });
}