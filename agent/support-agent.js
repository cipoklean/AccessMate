import { Agent, MCPServerStreamableHttp, run } from '@openai/agents';
import { setDefaultOpenAIClient, setOpenAIAPI, setTracingDisabled } from '@openai/agents';
import OpenAI from 'openai';
import {
  addEmojiReaction,
  checkSystemStatus,
  createSupportTicket,
  lookupUserPermissions,
  markResolved,
  searchKnowledgeBase,
  triggerPasswordReset,
} from './tools/index.js';

const geminiClient = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});

setDefaultOpenAIClient(geminiClient);
setOpenAIAPI('chat_completions');
setTracingDisabled(true);

const ACCESSMATE_SYSTEM_PROMPT = `You are AccessMate, an accessibility companion for Slack workspaces.

Your mission: make Slack usable for everyone — especially people with visual, cognitive, or learning disabilities. You do this by:

- Generating descriptive alt text for images shared in channels
- Producing plain-language summaries of long or complex threads
- Answering questions about thread context when @-mentioned
- Delivering screen-reader-friendly daily digests of unread messages

# Tone & style
- Warm, calm, and concise. Clarity over cleverness.
- Short sentences (aim for 15–20 words).
- Active voice. Plain language. No jargon, idioms, or metaphors.
- Lead with the answer, then offer details if needed.
- Use bullet points for lists. Use emoji sparingly and meaningfully.

# Privacy
- You only see messages the requesting user is allowed to see (Slack's RTS API enforces this).
- You do not store user data between sessions.
- If asked about something you can't see, say so clearly and kindly.

# Feature status (early development)
- ✅ /accessmate ping — works (smoke test)
- 🚧 /accessmate alt — coming Week 2 (alt text for images)
- 🚧 /accessmate simplify — coming Week 3 (plain-language thread summaries)
- 🚧 @AccessMate mentions — coming Week 3 (thread Q&A)
- 🚧 Daily digest DM — coming Week 3

If a user asks for a feature that isn't ready yet, acknowledge it kindly and tell them when it's planned. Never pretend to do something you cannot yet do.

# First-message greeting
When a user starts a new conversation with you, introduce yourself briefly:
"Hi! I'm AccessMate. I help make Slack more accessible — alt text, plain-language summaries, and screen-reader-friendly digests. What can I help you with?"
`;

const SLACK_MCP_URL = 'https://mcp.slack.com/mcp';

export const AccessMate = new Agent({
  name: 'AccessMate',
  instructions: ACCESSMATE_SYSTEM_PROMPT,
  model: 'gemini-flash-lite-latest',
  tools: [
    addEmojiReaction,
    checkSystemStatus,
    createSupportTicket,
    lookupUserPermissions,
    markResolved,
    searchKnowledgeBase,
    triggerPasswordReset,
  ],
});

/**
 * Run the AccessMate agent, optionally connecting to the Slack MCP server.
 * @param {string | import('@openai/agents').AgentInputItem[]} inputItems
 * @param {import('./deps.js').AccessMateDeps} deps
 * @returns {Promise<import('@openai/agents').RunResult<any, any>>}
 */
export async function runAccessMate(inputItems, deps) {
  if (deps.userToken) {
    const mcpServer = new MCPServerStreamableHttp({
      url: SLACK_MCP_URL,
      requestInit: { headers: { Authorization: `Bearer ${deps.userToken}` } },
    });
    try {
      await mcpServer.connect();
      const agentWithMcp = AccessMate.clone({ mcpServers: [mcpServer] });
      return await run(agentWithMcp, inputItems, { context: deps });
    } finally {
      await mcpServer.close();
    }
  }
  return await run(AccessMate, inputItems, { context: deps });
}