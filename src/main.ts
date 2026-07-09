import 'dotenv/config';
import express, { Request } from 'express';
import { startSmeeProxy } from './proxy/smee.ts'
import { createNodeMiddleware } from "@octokit/webhooks";
import { GithubWHActions } from './github/github.webhook.ts';
import { GithubService } from './github/github.service.ts';
import { AnthropicService } from './agents/anthropic/anthropic.service.ts';

async function main() {
  const wizard = express();
  const PORT = process.env.PORT || 9898;
  
  // pre
  wizard.use(express.json());
  
  // health check
  wizard.get("/ping", (_req, res) => {
    res.status(200).send("pong");
  });

  // check identity
  wizard.get("/self", async (_req, res) => {
    const identity = await GithubService.getIdentity();
    res.status(200).send({ message: 'self', data: identity });
  });
  
  wizard.get("/repos", async (_req, res) => {
    const repos = await GithubService.checkRepositories();
    res.status(200).send({ message: 'repos', data: repos });
  });
  
  // check config for anthropic
  wizard.get("/config/anthropic", async (_req, res) => {
    const anthropicConfig = await AnthropicService.getConfig();
    res.status(200).send(anthropicConfig);
  });

  wizard.patch("/config/anthropic", async (req,res) => {
    
  });

  interface UpdateAnthropicConfigBody {
    maxTokens?: string;
    model?: string;
    maxIterations?: string;
    summaryMaxTokens?: string;
    summaryMaxIterations?: string;
  }
  // update config for anthropic
  wizard.put("/config/anthropic", async (req: Request<never,never,UpdateAnthropicConfigBody>, res) => {
    const { maxTokens, model, maxIterations, summaryMaxIterations, summaryMaxTokens } = req.body
    const anthropicSettings = await AnthropicService.updateConfig({
      max_tokens: parseInt(maxTokens),
      model: model,
      max_iterations: parseInt(maxIterations),
      summary_max_iterations: summaryMaxIterations ?? parseInt(summaryMaxIterations),
      summary_max_tokens: summaryMaxTokens,
    });
    res.status(200).send(anthropicSettings);
  });

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
