import { Octokit } from '@octokit/rest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

if (!process.env.GITHUB_TOKEN) {
  throw new Error("GITHUB_TOKEN environment variable is required");
}

const execFileAsync = promisify(execFile);

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  repository: string; 
}

export interface ResolveIssueResult {
  summary: string;
  iterations: number;
  stopReason: string | null;
}

const octokit = new Octokit({ 
  auth: process.env.GITHUB_TOKEN
});

export interface GithubRepoResponse {
  name: string;
  url: string;
  clonedLocally: boolean;
}

export interface GithubIdentity {
  login: string;
}

export interface CloneReposResult {
  cloned: string[];
  skipped: string[];
  failed: { repo: string; error: string }[];
}

export interface CommitAndOpenPullRequestParams {
  repoDir: string;
  owner: string;
  repo: string;
  issueNumber: number;
  branchName?: string;
  commitMessage?: string;
  prTitle?: string;
  prBody?: string;
}

export interface CommitAndOpenPullRequestResult {
  branch: string;
  baseBranch: string;
  committed: boolean;
  prNumber: number | null;
  prUrl: string | null;
}

export class GithubService {
  private static gitAuthHeader = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${process.env.GITHUB_TOKEN}`).toString('base64')}`;

  private static git(args: string[], cwd: string) {
    return execFileAsync("git", args, { cwd });
  }

  private static gitWithAuth(args: string[], cwd: string) {
    return execFileAsync("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'http.extraheader',
        GIT_CONFIG_VALUE_0: this.gitAuthHeader,
      },
    });
  }
  

  public static async getIdentity(): Promise<GithubIdentity> {
    let identity: GithubIdentity = { login: "" };
    try {
      const { data } = await octokit.rest.users.getAuthenticated();
      identity.login = data.login
    } catch (error: any) {
      console.error(`Error fetching issues: ${error.message}`);
    }
    return identity;
  }  
  
  public static async checkRepositories(): Promise<GithubRepoResponse[]> {
    let fRepos: GithubRepoResponse[] = []
    try {
      const { data } = await octokit.rest.repos.listForAuthenticatedUser({
        visibility: "all",
      });
      const reposDir = path.join(process.cwd(), 'repos');
      fRepos = data.map((repo) => {
        return {
          name: repo.full_name,
          url: repo.html_url,
          clonedLocally: existsSync(path.join(reposDir, repo.name)),
        }
      })
      return fRepos;
    } catch (error: any) {
      console.error("Error fetching repositories:", error.message);
    }
    return fRepos
  }

  public static async cloneAccessibleRepos(): Promise<CloneReposResult> {
    const repoResult: CloneReposResult = { cloned: [], skipped: [], failed: [] };
    const reposDir = path.join(process.cwd(), 'repos');
    await mkdir(reposDir, { recursive: true });
    const { data } = await octokit.rest.repos.listForAuthenticatedUser({
      visibility: "all",
      per_page: 100,
    });

    const enabledRepos = (process.env.ENABLED_REPOS ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const repos = enabledRepos.length
      ? data.filter((repo) => enabledRepos.includes(repo.name) || enabledRepos.includes(repo.full_name))
      : data;

    for (const repo of repos) {
      const targetDir = path.join(reposDir, repo.name);
      if (existsSync(targetDir)) {
        repoResult.skipped.push(repo.full_name);
        continue;
      }
      try {
        await execFileAsync('git', ['clone', repo.clone_url, targetDir], {
          env: {
            ...process.env,
            GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: 'http.extraheader',
            GIT_CONFIG_VALUE_0: this.gitAuthHeader,
          },
        });
        repoResult.cloned.push(repo.full_name);
      } catch (error: any) {
        repoResult.failed.push({ repo: repo.full_name, error: error.message });
      }
    }

    return repoResult;
  }

  public static async checkRepos() {
    try {
      const response = await octokit.rest.issues.listForRepo({
        owner: "zai-land",
        repo: "pond",
        state: "open",
        per_page: 10
      });
      const issuesOnly = response.data.filter(issue => !issue.pull_request);
      issuesOnly.forEach(issue => {
        console.log(`Issue #${issue.number}: ${issue.title}`);
        console.log(`URL: ${issue.html_url}\n`);
      });
    } catch (error: any) {
      console.error(`Error fetching issues: ${error.message}`);
    }
  }

  public static async checkoutBranch(repoDir: string, branch = "main") {
    await this.git(["checkout", branch], repoDir);
  }

  public static async commitAndOpenPullRequest(
    params: CommitAndOpenPullRequestParams,
  ): Promise<CommitAndOpenPullRequestResult> {
    const { repoDir, owner, repo, issueNumber } = params;
    const branchName = params.branchName ?? `fix-issue-${issueNumber}`;
    const commitMessage = params.commitMessage ?? `Fix #${issueNumber}`;

    // find the base branch (sometimes main, sometimes master)
    const { stdout: baseBranchOut } = await this.git(["rev-parse", "--abbrev-ref", "HEAD"], repoDir);
    const baseBranch = baseBranchOut.trim();

    const { data: baseRef } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${baseBranch}`,
    });
    await octokit.rest.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: baseRef.object.sha,
    });

    await this.gitWithAuth(["fetch", "origin", branchName], repoDir);
    await this.git(["checkout", "-b", branchName, "FETCH_HEAD"], repoDir);

    const { stdout: statusOut } = await this.git(["status", "--porcelain"], repoDir);
    if (!statusOut.trim()) {
      return { branch: branchName, baseBranch, committed: false, prNumber: null, prUrl: null };
    }

    await this.git(["add", "-A"], repoDir);
    await this.git(["commit", "-m", commitMessage], repoDir);
    await this.gitWithAuth(["push", "-u", "origin", branchName], repoDir);

    const { data: pr } = await octokit.rest.pulls.create({
      owner,
      repo,
      title: params.prTitle ?? commitMessage,
      head: branchName,
      base: baseBranch,
      body: params.prBody ?? `Closes #${issueNumber}`,
    });
    
    await this.checkoutBranch(repoDir, baseBranch);
    return { branch: branchName, baseBranch, committed: true, prNumber: pr.number, prUrl: pr.html_url };
  }

  // public static async checkoutNewBranch(issue: string) {
  //   const { data: mainRef } = await octokit.rest.git.getRef({
  //     owner: 'zai-land',
  //     repo: 'pond',
  //     ref: 'heads/master',
  //   });
  //   console.log('mainRef stringified: ', JSON.stringify(mainRef,null,2))

  //   const newRefName = `issue-133`
  //   await octokit.rest.git.createRef({
  //     owner: 'zai-land',
  //     repo: 'pond',
  //     ref: `refs/heads/${newRefName}`,
  //     sha: mainRef.object.sha,
  //   });
  // }
  
  public static async getRepoIssues() {
    try {
      const response = await octokit.rest.issues.listForRepo({
        owner: "zai-land",
        repo: "pond",
        state: "open",
        per_page: 10
      });
      const issuesOnly = response.data.filter(issue => !issue.pull_request);
      issuesOnly.forEach(issue => {
        console.log(`Issue #${issue.number}: ${issue.title}`);
        console.log(`URL: ${issue.html_url}\n`);
      });
    } catch (error: any) {
      console.error(`Error fetching issues: ${error.message}`);
    }
  }

  public static async getRepoIssue(repo: string, issueNumber: number) {
    console.log('process.env.GITHUB_TOKEN: ', process.env.GITHUB_TOKEN)
    try {
      const ghIssue = await octokit.rest.issues.get({
        owner: 'zai-land',
        repo: repo,
        issue_number: issueNumber,
      })
      console.log('the issue: ', JSON.stringify(ghIssue,null,2))
    } catch (err: any) {
      console.error('err: ', err);
    }
  }

  public static async assignIssue(assignees: [string], repo: string, issueNumber: number) {
    await octokit.rest.issues.update({
      owner: "org-or-username",
      repo: repo,
      issue_number: issueNumber,
      assignees: assignees,
    });
  }
}
