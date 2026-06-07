import { OpenAI } from 'openai';
import https from 'node:https';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;


const slackHttpsAgent = new https.Agent({
  keepAlive: false,
  rejectUnauthorized: true,
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.2',
});

const visionClient = new OpenAI({
  apiKey: GEMINI_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});

const SIMPLIFY_PROMPT = `You simplify Slack threads for cognitive accessibility.

Read the thread below. Output a plain-language summary at a 5th-grade reading level.

FORMAT (strict):
- Output ONLY a bullet list. No preamble. No closing line.
- Each bullet starts with "- " (hyphen + space).
- One bullet per line. Use a real newline between every bullet.
- 3 to 5 bullets total. Each bullet under 20 words.

CONTENT RULES:
- If the thread reached a DECISION or AGREED OUTCOME, the FIRST bullet MUST state that decision. Example: "- The team agreed to use a hybrid design."
- If the thread has an ACTION ITEM (someone will do X on Y), include it as a bullet.
- If the thread is a question with no resolution, the first bullet must say: "- The team has not decided yet."
- Use simple words. Avoid jargon. Define acronyms on first use.
- Use "the team" or "someone" instead of @-mentions or names, unless a name carries meaning.
- No emoji. No bold, no italic, no headings.

EXAMPLE — input thread:
[msg] Should we move to TypeScript?
[msg] +1, type safety will save us bugs.
[msg] Agreed. Let's migrate the API layer first next sprint.

EXAMPLE — correct output:
- The team agreed to switch to TypeScript.
- They will start with the API layer next sprint.
- The main reason is to catch bugs earlier with type safety.

THREAD:
{messages}`;

function formatThread(messages) {
  return messages
    .map((m) => {
      const text = (m.text || '').replace(/<@U[A-Z0-9]+>/g, '@someone').trim();
      return text ? `[msg] ${text}` : null;
    })
    .filter(Boolean)
    .join('\n');
}

async function generateSummary(threadText) {
  const response = await visionClient.chat.completions.create(
    {
      model: 'gemini-3.1-flash-lite',
      messages: [
        {
          role: 'user',
          content: SIMPLIFY_PROMPT.replace('{messages}', threadText),
        },
      ],
      max_tokens: 400,
      temperature: 0.3,
    },
    { timeout: 30000, maxRetries: 1 }
  );
  return response.choices[0]?.message?.content?.trim() || 'Could not generate summary.';
}

function normalizeBullets(text) {
  // Split on any bullet marker, rejoin one-per-line
  const parts = text
    .split(/(?:^|\s+)[-*•]\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return text.trim();
  return parts.map((p) => `- ${p}`).join('\n');
}

export function registerSimplifyShortcut(app) {
  app.shortcut('simplify_thread', async ({ shortcut, ack, client, context, logger }) => {
    await ack();
    try {
      const channelId = shortcut.channel.id;
      const threadTs = shortcut.message.thread_ts || shortcut.message.ts;
      const userId = shortcut.user.id;

      const result = await client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: 100,
      });

      const messages = result.messages || [];
      if (messages.length === 0) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: '⚠️ Could not find any messages to simplify.',
        });
        return;
      }

      const threadText = formatThread(messages);
      if (!threadText) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: '⚠️ Thread had no text to simplify (images only?).',
        });
        return;
      }

      const rawSummary = await generateSummary(threadText);
      const summary = normalizeBullets(rawSummary);
      logger?.info?.(`[simplify] fetched ${messages.length} message(s), summary ${summary.length}c`);

      const count = messages.length;
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: `📝 *Plain-language summary* (${count} message${count === 1 ? '' : 's'}):\n\n${summary}\n\n_Copy this into a reply or save it for later._`,
      });
    } catch (err) {
      logger?.error?.(`Simplify shortcut error: ${err}`);
      try {
        await client.chat.postEphemeral({
          channel: shortcut.channel.id,
          user: shortcut.user.id,
          text: `⚠️ Could not simplify: ${err.message || 'unknown error'}`,
        });
      } catch {}
    }
  });
}

function parseSlackMessageLink(url) {
  const m = url.match(/\/archives\/([CDG][A-Z0-9]+)\/p(\d{10})(\d{6})/);
  if (!m) return null;
  const [, channel, secs, micros] = m;
  let ts = `${secs}.${micros}`;
  const threadMatch = url.match(/[?&]thread_ts=([\d.]+)/);
  if (threadMatch) ts = threadMatch[1];
  return { channel, ts };
}

export async function handleSimplifySlash({ command, respond, client, logger }) {
  try {
    const text = (command.text || '').trim();
    // Parent /accessmate router has already stripped "simplify" — text is link or empty
    const link = text.split(/\s+/).find((t) => t.startsWith('http'));

    if (!link) {
      await respond({
        response_type: 'ephemeral',
        text:
          '💡 *How to use:* `/accessmate simplify <message-link>`\n\n' +
          'To get a message link: hover the message → ⋯ → *Copy link*.\n' +
          'Or use the *Simplify thread* shortcut directly from any message ⋯ menu.',
      });
      return;
    }

    const parsed = parseSlackMessageLink(link);
    if (!parsed) {
      await respond({
        response_type: 'ephemeral',
        text: "⚠️ Couldn't parse that link. Make sure it's a Slack message link.",
      });
      return;
    }

    const result = await client.conversations.replies({
      channel: parsed.channel,
      ts: parsed.ts,
      limit: 100,
    });

    const messages = result.messages || [];
    if (messages.length === 0) {
      await respond({
        response_type: 'ephemeral',
        text: '⚠️ Could not find any messages at that link.',
      });
      return;
    }

    const threadText = formatThread(messages);
    if (!threadText) {
      await respond({
        response_type: 'ephemeral',
        text: '⚠️ Thread had no text to simplify.',
      });
      return;
    }

    const rawSummary = await generateSummary(threadText);
    const summary = normalizeBullets(rawSummary);
    logger?.info?.(`[simplify slash] ${messages.length} msg(s), summary ${summary.length}c`);

    const count = messages.length;
    await respond({
      response_type: 'ephemeral',
      text: `📝 *Plain-language summary* (${count} message${count === 1 ? '' : 's'}):\n\n${summary}`,
    });
  } catch (err) {
    logger?.error?.(`Simplify slash error: ${err}`);
    await respond({
      response_type: 'ephemeral',
      text: `⚠️ Could not simplify: ${err.message || 'unknown error'}`,
    });
  }
}