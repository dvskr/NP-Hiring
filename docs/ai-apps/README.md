# NP Hiring app for Claude and ChatGPT

The connector at `https://nphiring.com/mcp` lets nurse practitioner and APRN candidates search NP Hiring jobs, check
pay and practice authority, and apply from Claude, ChatGPT and other MCP clients. How it works, where the code
lives and what it needs: [../mcp/README.md](../mcp/README.md). Submission steps and listing copy:
[submission.md](submission.md). Public page: https://nphiring.com/ai-apps.

The first version (built 2026-10-28: `/mcp` for Claude and `/mcp/chatgpt` for ChatGPT, a signing secret, reviewer
sandbox jobs) was replaced on 2026-11-23 by PMHNP Hiring's design. Its sign-in never went live, so nobody was
connected to it; its tables were dropped empty by `20261123000000_replace_ai_app_oauth`. The three unpublished
sandbox jobs it may have left in production (`sourceProvider` `nphiring-review-sandbox`) are no longer read by
anything.

## Operations

- **A candidate wants an app disconnected:** Settings, Account, Connected apps, Remove access. It stops working at
  once.
- **Directory review:** put the reviewer's account email or id in `MCP_TEST_ACCOUNTS`; its applications from an
  assistant are checked like any other and never stored or delivered, and the review card says so.
- **Widget change:** edit `lib/mcp/widgets/src`, run `npm run build:mcp-widgets`, commit
  `lib/mcp/widgets/generated/bundle.ts`. The widget URI carries its hash, so hosts fetch the new copy.
- **ChatGPT package:** `openai-plugin/` (`mcp.json` points at `/mcp`).
