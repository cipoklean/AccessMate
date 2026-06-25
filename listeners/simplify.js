import { buildErrorCard } from '../lib/errorCard.js';
import { chatComplete, classifyLlmError, normalizeBullets } from '../lib/llm.js';
import { sanitizeForSlack, stripSlackMarkup } from '../lib/sanitize.js';

const SIMPLIFY_THREAD_PROMPT = `You simplify Slack threads for cognitive accessibility.

Read the multi-message conversation provided by the user. Output a plain-language summary at a 5th-grade reading level.

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
- The main reason is to catch bugs earlier with type safety.`;

const SIMPLIFY_SINGLE_PROMPT = `You rewrite content in plain language for cognitive accessibility.

Read the single message provided by the user. Output a plain-language summary at a 5th-grade reading level.

FORMAT (strict):
- Output ONLY a bullet list. No preamble. No closing line.
- Each bullet starts with "- " (hyphen + space).
- One bullet per line. Use a real newline between every bullet.
- 3 to 5 bullets total. Each bullet under 20 words.

CONTENT RULES:
- Summarize the key information in plain words.
- Use simple words. Avoid jargon. Define acronyms on first use.
- The input is NOT a conversation. Do NOT use phrases like "the team", "someone said", "they decided", "the discussion", "the thread", or any other conversation framing.
- Describe what the content says, not who said it.
- No emoji. No bold, no italic, no headings.

EXAMPLE — input:
The Arc Lending dashboard shows $500,000 total supplied at 0% APY and 2% borrow APY. The connected wallet holds 570,400 USDC and 18 WETH. To use the tool, users supply USDC, deposit collateral, then borrow USDC.

EXAMPLE — correct output:
- The Arc Lending dashboard has $500,000 of USDC supplied to the protocol.
- Suppliers earn 0% interest right now, while borrowers pay 2% per year.
- The connected wallet holds 570,400 USDC and 18 WETH ready to use.
- To use the tool: supply USDC, add collateral, then borrow USDC.`;

function formatThread(messages) {
  return messages
    .map((m) => {
      const text = stripSlackMarkup(m.text || '').trim();
      return text ? `[msg] ${text}` : null;
    })
    .filter(Boolean)
    .join('\n');
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

async function generateSummary(threadText, messageCount) {
  const isThread = messageCount > 1;
  const systemPrompt = isThread ? SIMPLIFY_THREAD_PROMPT : SIMPLIFY_SINGLE_PROMPT;
  const userLabel = isThread ? 'THREAD' : 'CONTENT';
  const raw = await chatComplete({
    systemPrompt,
    userContent: `${userLabel}:\n${threadText}`,
    maxTokens: 400,
    temperature: 0.3,
  });
  return sanitizeForSlack(normalizeBullets(raw));
}

function buildSummaryCard(summary, count) {
  const plural = count === 1 ? '' : 's';
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: '📝 Plain-language summary', emoji: true } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `Summarized *${count}* message${plural}` }] },
    { type: 'section', text: { type: 'mrkdwn', text: summary } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: '🌍 5th-grade reading level for cognitive accessibility' }] },
  ];
  return { text: `📝 Plain-language summary (${count} message${plural}):\n\n${summary}`, blocks };
}

export function registerSimplifyShortcut(app) {
  app.shortcut('simplify_thread', async ({ shortcut, ack, client, logger }) => {
    await ack();
    const channelId = shortcut.channel.id;
    const userId = shortcut.user.id;
    let messages = [];
    try {
      const threadTs = shortcut.message.thread_ts || shortcut.message.ts;
      const result = await client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: 100,
      });
      messages = result.messages || [];
      if (messages.length === 0) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          ...buildErrorCard({
            title: 'No messages found',
            body: 'I could not find any messages in that thread.',
            hint: 'Make sure the thread still exists and that the bot has access to the channel.',
          }),
        });
        return;
      }
      const threadText = formatThread(messages);
      if (!threadText) {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          ...buildErrorCard({
            title: 'Nothing to simplify',
            body: 'This thread had no text content (just images or attachments).',
            hint: 'Simplify works on text-heavy threads. Try a different thread with discussion content.',
          }),
        });
        return;
      }
      const summary = await generateSummary(threadText, messages.length);
      logger?.info?.(`[simplify] ${messages.length} msg(s), summary ${summary.length}c`);
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        ...buildSummaryCard(summary, messages.length),
      });
    } catch (err) {
      logger?.error?.('[simplify shortcut] error:', err);
      try {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          ...buildErrorCard({
            title: 'Simplify failed',
            body: classifyLlmError(err, { task: 'simplify', detail: `(${messages.length} messages were found.)` }),
            hint: 'Try again in a moment. If this persists, the thread may be too long — try a shorter one.',
          }),
        });
      } catch (notifyErr) {
        logger?.error?.('[simplify shortcut] failed to notify user:', notifyErr);
      }
    }
  });
}

export async function handleSimplifySlash({ command, respond, client, logger }) {
  let messages = [];
  try {
    const text = (command.text || '').trim();
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
        ...buildErrorCard({
          title: 'Invalid link',
          body: "I couldn't parse that as a Slack message link.",
          hint: 'Hover the message → ⋯ → *Copy link*, then paste it after `/accessmate simplify`.',
        }),
      });
      return;
    }

    const result = await client.conversations.replies({
      channel: parsed.channel,
      ts: parsed.ts,
      limit: 100,
    });
    messages = result.messages || [];
    if (messages.length === 0) {
      await respond({
        response_type: 'ephemeral',
        ...buildErrorCard({
          title: 'No messages found',
          body: 'I could not find any messages at that link.',
          hint: 'Make sure the message still exists. If the channel is private, invite me with `/invite @AccessMate`.',
        }),
      });
      return;
    }

    const threadText = formatThread(messages);
    if (!threadText) {
      await respond({
        response_type: 'ephemeral',
        ...buildErrorCard({
          title: 'Nothing to simplify',
          body: 'This thread had no text content.',
          hint: 'Simplify works on text-heavy threads. Try a different thread with discussion content.',
        }),
      });
      return;
    }

    const summary = await generateSummary(threadText, messages.length);
    logger?.info?.(`[simplify slash] ${messages.length} msg(s), summary ${summary.length}c`);
    await respond({
      response_type: 'ephemeral',
      ...buildSummaryCard(summary, messages.length),
    });
  } catch (err) {
    logger?.error?.('[simplify slash] error:', err);
    await respond({
      response_type: 'ephemeral',
      ...buildErrorCard({
        title: 'Simplify failed',
        body: classifyLlmError(err, { task: 'simplify', detail: `(${messages.length} messages were found.)` }),
        hint: 'Try again in a moment. If this persists, the thread may be too long — try a shorter one.',
      }),
    });
  }
}
