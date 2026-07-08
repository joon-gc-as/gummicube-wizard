# gummicube-wizard

An autonomous GitHub issue-resolver bot. When an issue is assigned to the bot's GitHub
account, it clones/uses a local checkout of the repo, hands the issue off to Claude
(via the Anthropic API) to investigate and fix, then commits the changes and opens a
pull request back to the repo.

## How it works

1. A GitHub webhook (`issues.assigned`) fires when an issue is assigned to the bot's
   GitHub user.
2. `GithubWHActions` (in `src/github/github.webhook.ts`) checks that the assignee is
   the bot, then looks for a local clone of the repo under `repos/<repo-name>`.
3. `AnthropicAgent.resolveIssue` (in `src/agents/anthropic/anthropic.ts`) drives an
   agentic loop against the Claude API: the model gets `bash` and text-editor tools,
   investigates the codebase, makes changes, and verifies its work — for up to N
   iterations.
4. Once the model is done, a follow-up call asks it to summarize the changes it made,
   written for a pull request description.
5. `GithubService.commitAndOpenPullRequest` commits whatever changed, pushes a new
   branch, and opens a PR with that summary as the body.

In development, a [smee.io](https://smee.io) client (`src/proxy/smee.ts`) forwards
GitHub webhook deliveries to your local server so you don't need a public endpoint.

## Prerequisites

- Node.js (native TypeScript execution — no build step required)
- A GitHub account/token for the bot, with a webhook configured on the repos you want
  it to watch (or a GitHub App)
- An Anthropic API key

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy the environment variables below into a `.env` file at the project root.

3. (Development only) Create a smee.io proxy channel and add the URL it prints to
   your `.env` as `SMEE_URL`:

   ```sh
   node src/scripts/setup-proxy.ts
   ```

   Point your GitHub webhook's payload URL at that smee.io URL — `smee.ts` forwards
   deliveries from it to `http://localhost:<PORT>/github/webhooks`.

4. Clone every repo the bot's GitHub token has access to into `./repos` (skipped for
   repos already cloned there). Set `ENABLED_REPOS` first to restrict this to a
   specific set of repos:

   ```sh
   npm run setup
   ```

## Running

```sh
npm run dev
```

This starts the Express server (default port `9898`) and, outside of production,
starts the smee proxy alongside it.

## Environment variables

| Variable                | Required | Description                                                              |
| ------------------------ | -------- | -------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`      | Yes      | API key used to call Claude.                                             |
| `GITHUB_TOKEN`           | Yes      | Token for the bot's GitHub account/App — used for git operations and the GitHub API. |
| `GITHUB_WEBHOOK_SECRET`  | Yes      | Secret configured on the GitHub webhook, used to verify deliveries.      |
| `GITHUB_USERNAME`        | No       | The bot's GitHub username.                                               |
| `ENABLED_REPOS`          | No       | Comma-separated repo names/full names to limit `npm run setup` to.       |
| `SMEE_URL`               | Dev only | smee.io channel URL used to forward webhook deliveries locally.          |
| `PORT`                   | No       | Port for the Express server (default `9898`).                           |
| `NODE_ENV`               | No       | Set to `production` to skip starting the smee proxy.                    |

## API

| Method | Path               | Description                                              |
| ------ | ------------------ | ---------------------------------------------------------- |
| GET    | `/ping`             | Health check.                                             |
| GET    | `/self`             | Returns the authenticated GitHub identity for the bot's token. |
| GET    | `/self/repos`       | Lists repos visible to the bot's token and whether each is cloned locally. |
| GET    | `/settings`         | Returns the current Anthropic agent settings.             |
| POST   | `/github/webhooks`  | GitHub webhook receiver.                                  |

See `endpoints.rest` for ready-to-run requests.

## Project structure

```
src/
  main.ts                    Express app entrypoint
  agents/
    anthropic/
      anthropic.ts            Claude-driven issue-resolution agent
      settings.json            Model/agent settings
    gemini/                   (reserved for a future Gemini-backed agent)
  github/
    github.service.ts          GitHub API + git operations (clone, commit, open PR, etc.)
    github.webhook.ts          Webhook event handlers
  proxy/
    smee.ts                    Local webhook forwarding (dev only)
  scripts/
    clone-repos.ts              `npm run setup` — clone accessible repos
    setup-proxy.ts               One-off helper to create a smee.io channel
```

Cloned repos live under `repos/` (git-ignored) and are what the agent actually reads
and edits when resolving an issue.
