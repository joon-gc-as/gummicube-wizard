import { Webhooks } from "@octokit/webhooks";
import { existsSync } from "node:fs";
import path from "node:path";
import { GithubService } from './github.service.ts';

import { AnthropicAgent } from '../agents/anthropic/anthropic.agent.ts';

if (!process.env.GITHUB_WEBHOOK_SECRET) {
  throw new Error("GITHUB_WEBHOOK_SECRET environment variable is required");
}

export const GithubWHActions = new Webhooks({
  secret: process.env.GITHUB_WEBHOOK_SECRET,
});

///////////////////////////////////////////////////////////////////////////////
//                                EVENT LOGGER                               //
///////////////////////////////////////////////////////////////////////////////
// GithubWebhooks.onAny(({ id, name, payload }) => {
//   console.log(`[GitHub] Event received: ${name}, ${id}, ${JSON.stringify(payload,null,2)}`);
// });

///////////////////////////////////////////////////////////////////////////////
//                               ERROR HANDLER                               //
///////////////////////////////////////////////////////////////////////////////
GithubWHActions.onError((error) => {
  console.error(`Error in "${error.event?.name}" handler:`, error);
});

///////////////////////////////////////////////////////////////////////////////
//                               EVENT LISTENER                              //
///////////////////////////////////////////////////////////////////////////////
GithubWHActions.on("push", ({ payload }) => {
  console.log(
    `[push] ${payload.pusher.name} pushed to ${payload.repository.full_name}`
  );
});

GithubWHActions.on("pull_request.opened", ({ payload }) => {
  console.log(
    `[PR opened] "${payload.pull_request.title}" by ${payload.pull_request.user.login}`
  );
});

GithubWHActions.on("pull_request.closed", ({ payload }) => {
  if (payload.pull_request.merged) {
    console.log(`[PR merged] "${payload.pull_request.title}"`);
  }
});

// GithubWebhooks.on("issues.opened", async ({ payload }) => {
//   console.log(
//     `[issue opened] "${payload.issue.title}" by ${payload.issue.user?.login}`
//   );
// });

// when an issue is assigned to the wizard...
GithubWHActions.on("issues.assigned", async ({ payload }) => {
  const wizardUN = await GithubService.getIdentity();
  const isAssignedToWizard = payload.issue.assignee?.login === wizardUN.login;
  if (!isAssignedToWizard) return;

  console.log('assigned to wizard!');
  const repoDir = path.join(process.cwd(), "repos", payload.repository.name);
  if (!existsSync(repoDir)) {
    console.error(`[issue assigned] repo not cloned locally: ${payload.repository.full_name}`);
    return;
  }
  
  console.log('attempting issue...: ', payload.issue);
  const result = await AnthropicAgent.resolveIssue(repoDir, {
    repository: payload.repository.full_name,
    number: payload.issue.number,
    title: payload.issue.title,
    body: payload.issue.body ?? "",
  });

  console.log(
    `[issue #${payload.issue.number}] resolved after ${result.iterations} iteration(s), stop_reason=${result.stopReason}\n${result.summary}`
  );

  const pr = await GithubService.commitAndOpenPullRequest({
    repoDir,
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    issueNumber: payload.issue.number,
    prBody: `Closes #${payload.issue.number}\n\n${result.summary}`,
  });

  if (!pr.committed) {
    console.log(`[issue #${payload.issue.number}] no changes to commit; skipped PR`);
    return;
  }
  console.log(`[issue #${payload.issue.number}] opened PR #${pr.prNumber}: ${pr.prUrl}`);
});
