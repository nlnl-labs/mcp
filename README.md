# NL;NL Labs MCP connector

[![mcptry](https://mcptry.com/badge/com.nlnllabs/results)](https://mcptry.com/servers/com.nlnllabs/results)

Source for the read-only MCP server at `https://mcp.nlnllabs.com/mcp`. It reads the daily AI test results published on
[nlnllabs.com](https://nlnllabs.com) and returns them to Claude, ChatGPT or any MCP client. No account or sign-in.

Tools:

- `list_jobs`: the nine jobs, the models and systems tested on each, and the dates covered.
- `get_pick`: the outside model a job's page currently picks, with its date and figures. NL;NL Labs' own models are never the pick.
- `get_model_history`: one model's published results on one job, day by day.
- `get_day_results`: every model's result on one job on one day.

All data is read live from the public files on nlnllabs.com; nothing is stored here. Each tool call records the tool, the
job, model or date asked about, the calling app's name and the time; not the question or the IP address. Records are
deleted after 12 months. Privacy: https://nlnllabs.com/privacy/

Runs on Cloudflare Workers (`wrangler.jsonc`). Registry entry: `com.nlnllabs/results` (`server.json`).

Docs: https://nlnllabs.com/mcp/
