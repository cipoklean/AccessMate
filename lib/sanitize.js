/**
 * Strip Slack-specific markup from message text before sending to an LLM.
 *
 * Removes:
 *   - User mentions:   <@U123> <@U123|Name>
 *   - Usergroup refs:   <!subteam^S123|Group>
 *   - Special refs:     <!channel> <!here> <!everyone>
 *   - Link markup:     <https://example.com|Display Text>
 *   - Block refs:       <!date^1234567^{date_short}|Title>
 */
export function stripSlackMarkup(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<@[UW][A-Z0-9]+(?:\|[^>]+)?>/g, '@someone')
    .replace(/<!subteam\^[A-Z0-9]+(?:\|[^>]+)?>/g, '@team')
    .replace(/<!(?:channel|here|everyone)>/gi, '@channel')
    .replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, '$2 ($1)')
    .replace(/<!date\^[^|^>]*(?:\|[^>]*)?>/g, '')
    .replace(/<[^>]+>/g, '');
}

/**
 * Sanitize LLM output before posting it to Slack.
 *
 * Escapes characters that Slack interprets as markup to prevent
 * unexpected formatting or interactive block injection.
 */
export function sanitizeForSlack(text) {
  if (typeof text !== 'string') return '';
  // Strip any angle-bracket markup that could be interpreted as Slack special syntax
  // but keep intentional markdown (bold, italic, links) since our prompts avoid them
  return text.replace(/</g, '‹').replace(/>/g, '›');
}
