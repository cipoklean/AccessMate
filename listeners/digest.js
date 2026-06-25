const NO_GAPS_MSG = '🌱 No accessibility gaps today — every image in the last 24h had alt text. Nice work!';

function tsHoursAgo(hours) {
  return String(Math.floor((Date.now() - hours * 3600 * 1000) / 1000));
}

async function findGapsInChannel(client, channel, logger, lookbackHours = 24) {
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
  let channelsRes;
  try {
    channelsRes = await client.conversations.list({
      types: 'public_channel,private_channel',
      limit: 200,
      exclude_archived: true,
    });
  } catch (err) {
    logger?.error?.('[digest] failed to list channels:', err);
    return [];
  }
  const memberChannels = (channelsRes.channels || []).filter((c) => c.is_member);
  logger?.info?.(`[digest] scanning ${memberChannels.length} channels`);

  // Scan channels in parallel for speed
  const results = await Promise.allSettled(memberChannels.map((ch) => findGapsInChannel(client, ch, logger)));
  const allGaps = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      allGaps.push(...result.value);
    }
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

export async function runDigestNow(client, logger, targetUserId) {
  if (!targetUserId) {
    return { error: 'No target user — runDigestNow needs a Slack user ID' };
  }
  const gaps = await buildDigest(client, logger);
  const { text, blocks } = formatDigest(gaps);
  const im = await client.conversations.open({ users: targetUserId });
  const channel = im.channel?.id;
  if (!channel) throw new Error('Could not open IM channel');
  await client.chat.postMessage({ channel, text, blocks });
  logger?.info?.(`[digest] sent to ${targetUserId} (${gaps.length} gaps)`);
  return { sent: true, count: gaps.length };
}
