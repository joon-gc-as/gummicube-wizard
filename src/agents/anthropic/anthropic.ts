import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GitHubIssue, ResolveIssueResult } from "../../github/github.service.ts";
const execFileAsync = promisify(execFile);

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY environment variable is required");
}
const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

///////////////////////////////////////////////////////////////////////////////
//                                  settings                                 //
///////////////////////////////////////////////////////////////////////////////
const MODEL = "claude-opus-4-8";
const MAX_TOKENS = 16000;
const SUMMARY_MAX_TOKENS = 2000; // could be lower probably
const MAX_ITERATIONS = 10;
const SYSTEM_PROMPT = `You are an autonomous coding agent. You are given a GitHub issue and a checked-out
copy of the repository it belongs to, rooted at the current working directory. Investigate the
codebase using the bash and text editor tools, make the changes needed to resolve the issue, and
verify your work (run tests/build/lint if the repo has them) before ending your turn. Only make
changes directly required by the issue.`;
const SUMMARY_PROMPT = `Summarize the changes you made to resolve this issue, written for a pull
request description. Use markdown. Describe what changed and why, and call out any follow-up
steps (e.g. tests you couldn't run) the reviewer should be aware of. Do not include anything else
in your response other than the summary itself.`;

interface BashToolInput {
  command?: string;
  restart?: boolean;
}

interface TextEditorToolInput {
  command: "view" | "create" | "str_replace" | "insert";
  path: string;
  file_text?: string;
  old_str?: string;
  new_str?: string;
  insert_line?: number;
  insert_text?: string;
  view_range?: [number, number];
}

export class AnthropicAgent {
  private static resolvedRepoDir = "";

  public static async displaySettings() {
    return {
      model: MODEL,
      maxToken: MAX_TOKENS,
      maxIterations: MAX_ITERATIONS,
      summaryMaxToken: SUMMARY_MAX_TOKENS,
    }
  }
  
  public static async resolveIssue(
    repoDir: string,
    issue: GitHubIssue
  ): Promise<ResolveIssueResult> {
    this.resolvedRepoDir = path.resolve(repoDir);

    const tools: Anthropic.ToolUnion[] = [
      { type: "bash_20250124", name: "bash" },
      { type: "text_editor_20250728", name: "str_replace_based_edit_tool" },
    ];

    let messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `
          Resolve GitHub issue #${issue.number} in ${issue.repository}.
          Title: ${issue.title}
          Description: ${issue.body}
        `,
      },
    ];

    let response: Anthropic.Message | undefined;
    let iterations = 0;

    console.log('attempting iterations on issue...');
    while (iterations < MAX_ITERATIONS) {
      iterations++;

      console.log('iteration number:', iterations)
      const stream = anthropicClient.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });
      response = await stream.finalMessage();

      messages.push({ role: "assistant", content: response.content });

      if (response.stop_reason === "pause_turn") {
        continue;
      }

      if (response.stop_reason !== "tool_use") {
        break;
      }

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== "tool_use") continue;
        try {
          const result =
            block.name === "bash"
              ? await this.runBash(block.input as BashToolInput)
              : await this.runTextEditor(block.input as TextEditorToolInput);
          toolResults.push({ type: "tool_result", tool_use_id: block.id, content: result });
        } catch (error: any) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: error.message,
            is_error: true,
          });
        }
      }

      messages.push({ role: "user", content: toolResults });
    }

    // maybe the summary is not needed cause it uses some extra tokens
    // keep token usage low for this
    const summary = await this.summarizeChanges(messages);

    return { summary, iterations, stopReason: response?.stop_reason ?? null };
  }

  private static async summarizeChanges(messages: Anthropic.MessageParam[]): Promise<string> {
    const summaryResponse = await anthropicClient.messages.create({
      model: MODEL,
      max_tokens: SUMMARY_MAX_TOKENS,
      messages: [...messages, { role: "user", content: SUMMARY_PROMPT }],
    });

    return summaryResponse.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  }

  private static resolveInRepo(relativePath: string): string {
    const target = path.resolve(this.resolvedRepoDir, relativePath);
    if (target !== this.resolvedRepoDir && !target.startsWith(this.resolvedRepoDir + path.sep)) {
      throw new Error(`Path escapes repository: ${relativePath}`);
    }
    return target;
  }

  private static async runBash(input: BashToolInput): Promise<string> {
    if (input.restart) {
      return "(bash session restarted)";
    }
    try {
      const { stdout, stderr } = await execFileAsync("bash", ["-c", input.command ?? ""], {
        cwd: this.resolvedRepoDir,
        maxBuffer: 10 * 1024 * 1024,
      });
      return `${stdout}${stderr}`.trim() || "(no output)";
    } catch (error: any) {
      return `${error.stdout ?? ""}${error.stderr ?? error.message}`.trim();
    }
  }

  private static async runTextEditor(input: TextEditorToolInput): Promise<string> {
    const target = this.resolveInRepo(input.path);
    switch (input.command) {
      case "view": {
        const info = await stat(target).catch(() => null);
        if (!info) throw new Error(`Path not found: ${input.path}`);
        if (info.isDirectory()) {
          const entries = await readdir(target);
          return entries.join("\n");
        }
        const content = await readFile(target, "utf-8");
        const lines = content.split("\n");
        const [start, end] = input.view_range ?? [1, lines.length];
        return lines
          .slice(start - 1, end)
          .map((line, i) => `${start + i}\t${line}`)
          .join("\n");
      }
      case "create": {
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, input.file_text ?? "", "utf-8");
        return `Created ${input.path}`;
      }
      case "str_replace": {
        const content = await readFile(target, "utf-8");
        const oldStr = input.old_str ?? "";
        const occurrences = content.split(oldStr).length - 1;
        if (occurrences === 0) throw new Error(`No match for old_str in ${input.path}`);
        if (occurrences > 1) {
          throw new Error(
            `old_str matches ${occurrences} times in ${input.path}; must be unique`,
          );
        }
        const updated = content.replace(oldStr, input.new_str ?? "");
        await writeFile(target, updated, "utf-8");
        return `Replaced text in ${input.path}`;
      }
      case "insert": {
        const content = await readFile(target, "utf-8");
        const lines = content.split("\n");
        lines.splice(input.insert_line ?? 0, 0, input.insert_text ?? "");
        await writeFile(target, lines.join("\n"), "utf-8");
        return `Inserted text in ${input.path}`;
      }
      default:
        throw new Error(`Unknown text editor command: ${(input as any).command}`);
    }
  }
}
