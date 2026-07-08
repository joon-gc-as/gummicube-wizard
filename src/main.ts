import 'dotenv/config';
import express from 'express';
import { startSmeeProxy } from './proxy/smee.ts'
import { createNodeMiddleware } from "@octokit/webhooks";
import { GithubWHActions } from './github/github.webhook.ts';
import { GithubService } from './github/github.service.ts';
import { AnthropicAgent } from './agents/anthropic/anthropic.ts';

async function main() {
  const wizard = express();
  const PORT = process.env.PORT || 9898;

  // health check
  wizard.get("/ping", (_req, res) => {
    res.status(200).send("pong");
  });

  // check identity
  wizard.use("/self", async (_req, res) => {
    const identity = await GithubService.getIdentity();
    res.status(200).send({ message: 'self', data: identity });
  })

  // check settings
  wizard.use("/settings", async (_req, res) => {
    const anthropicSettings = await AnthropicAgent.displaySettings()
    res.status(200).send({ message: 'settings', data: {
      anthropic: anthropicSettings
    }});
  })

  wizard.use("/repos", async (_req, res) => {
    const repos = await GithubService.checkRepositories();
    res.status(200).send({ message: 'repos', data: repos });
  })
  // update/patch settings
  // wizard.put("/settings", async (_req, res) => {
  //   const anthropicSettings = await AnthropicAgent.updateSettings()
  // check repos
  //   res.status(200).send({ message: 'settings', data: {
  //     anthropic: anthropicSettings
  //   }});
  // })


  // Github Behaviour Webhook
  wizard.use(createNodeMiddleware(GithubWHActions, { path: '/github/webhooks'})),

  // Listen
  wizard.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Only run the proxy in development
    if (process.env.NODE_ENV !== "production") {
      startSmeeProxy();
      console.log(
        `Smee proxy forwarding: ${process.env.SMEE_URL} → localhost:${PORT}/github/webhooks`
      );
    }
  });
}

main()
