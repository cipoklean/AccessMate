import cron from 'node-cron';

const OWNER_USER_ID = process.env.OWNER_USER_ID;
const NO_GAPS_MSG = "🌱 No accessibility gaps today — every image in the last 24h had alt text. Nice work!";

function tsHoursAgo(hours) {
  return String(Math.floor((Date.now() - hours * 3600 * 1000) / 1000));
}

async function findGapsInChannel(client, channel, lookbackHours = 24, logger) {
  const oldest = tsHoursAgo(lookbackHours);
  try {
    const result = await client.conversations.history({
      channel: channel.id,
      oldest,
      limit: 200,
    });
    const gaps = [];
    for (const msg of result.messages || []) {
      if (!msg.files || msg.subtype === 'bot_message') continue;
      for (const file of msg.files) {
        if (!(file.mimetype || '').startsWith('image/')) continue;
        const hasAlt = !!(file.alt_txt && file.alt_txt.trim());
        if (!hasAlt) {
          gaps.push({
            channelName: channel.name,
            channelId: channel.id,
            messageTs: msg.ts,
            fileName: file.name || 'image',
            permalink: `https://slack.com/archives/${channel.id}/p${msg.ts.replace('.', '')}`,
            userId: msg.user,
          });
        }
      }
    }
    return gaps;
  } catch (err) {
    logger?.warn?.(`[digest] skipped #${channel.name}: ${err?.message}`);
    return [];
  }
}

async function buildDigest(client, logger) {
  const channelsRes = await client.conversations.list({
    types: 'public_channel,private_channel',
    limit: 200,
    exclude_archived: true,
  });
  const memberChannels = (channelsRes.channels || []).filter((c) => c.is_member);
  logger?.info?.(`[digest] scanning ${memberChannels.length} channels`);

  const allGaps = [];
  for (const ch of memberChannels) {
    const gaps = await findGapsInChannel(client, ch, 24, logger);
    allGaps.push(...gaps);
  }
  logger?.info?.(`[digest] found ${allGaps.length} alt-text gap(s)`);
  return allGaps;
}

function formatDigest(gaps) {
  if (gaps.length === 0) {
    return {
      text: NO_GAPS_MSG,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: NO_GAPS_MSG } }],
    };
  }
  const header = `🦻 *AccessMate daily digest* — *${gaps.length}* image${gaps.length === 1 ? '' : 's'} posted in the last 24h ${gaps.length === 1 ? 'is' : 'are'} missing alt text.`;
  const items = gaps
    .slice(0, 10)
    .map((g, i) => `${i + 1}. <${g.permalink}|${g.fileName}> in *#${g.channelName}* — posted by <@${g.userId}>`)
    .join('\n');
  const more = gaps.length > 10 ? `\n_…and ${gaps.length - 10} more._` : '';
  const tip = '💡 Tap any image → ⋯ menu → *Generate alt text* shortcut, and AccessMate writes one for you.';

  return {
    text: header,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: header } },
      { type: 'section', text: { type: 'mrkdwn', text: items + more } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: tip }] },
    ],
  };
}

export async function runDigestNow(client, logger) {
  if (!OWNER_USER_ID) {
    return { error: 'OWNER_USER_ID env var not set — add it to .env (your Slack user ID, starts with U)' };
  }
  const gaps = await buildDigest(client, logger);
  const { text, blocks } = formatDigest(gaps);

  const im = await client.conversations.open({ users: OWNER_USER_ID });
  const channel = im.channel?.id;
  if (!channel) throw new Error('Could not open IM channel');

  await client.chat.postMessage({ channel, text, blocks });
  logger?.info?.(`[digest] sent to ${OWNER_USER_ID} (${gaps.length} gaps)`);
  return { sent: true, count: gaps.length };
}

export function registerDigestCron(app) {
  // Daily at 9:00 AM Africa/Lagos
  cron.schedule(
    '0 9 * * *',
    async () => {
      try {
        await runDigestNow(app.client, app.logger);
      } catch (err) {
        app.logger?.error?.(`[digest/cron] ${err?.message || err}`);
      }
    },
    { timezone: 'Africa/Lagos' },
  );
  app.logger?.info?.('[digest] cron scheduled — daily at 09:00 Africa/Lagos');
}