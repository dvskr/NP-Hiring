/**
 * Directory listings of the NP Hiring app in Claude and ChatGPT
 * (docs/ai-apps/submission.md). Each stays null until that directory has
 * published the listing; /ai-apps only says "find it in the directory" when
 * the link is set, so the page never points at a listing that does not
 * exist yet.
 *
 * OWNER FILLS THESE after approval:
 *   claude:  https://claude.ai/directory/connectors/<slug>
 *   chatgpt: the listing link from platform.openai.com/plugins
 */
export const aiAppListings = {
    claude: null as string | null,
    chatgpt: null as string | null,
} as const;
