import { ConfigDB } from '../../db/sqlite.ts';

// default config
const defaultConfig = {
  model: "claude-opus-4-8",
  max_tokens: 16000,
  max_iterations: 10,
  summary_max_tokens: 2000, // could be lower probably
  summary_max_iterations: 1,
  system_prompt: `You are an autonomous coding agent. You are given a GitHub issue and a checked-out
  copy of the repository it belongs to, rooted at the current working directory. Investigate the
  codebase using the bash and text editor tools, make the changes needed to resolve the issue, and
  verify your work (run tests/build/lint if the repo has them) before ending your turn. Only make
  changes directly required by the issue.`,
  summary_prompt: `Summarize the changes you made to resolve this issue, written for a pull
  request description. Use markdown. Describe what changed and why, and call out any follow-up
  steps (e.g. tests you couldn't run) the reviewer should be aware of. Do not include anything else
  in your response other than the summary itself.`,
}

type AnthropicConfigData = typeof defaultConfig;

export class AnthropicService {
  public static async getConfig(): Promise<AnthropicConfigData> {
    const querySingle = ConfigDB.prepare(
      "SELECT json_extract(config, '$') AS config FROM settings WHERE id = ?"
    );
    const row = querySingle.get('anthropic') as { config: string | null };
    if (!row?.config) {
      const insert = ConfigDB.prepare('INSERT INTO settings (id, config) VALUES (?, jsonb(?))');
      insert.run('anthropic', JSON.stringify(defaultConfig));
      return defaultConfig;
    }
    return JSON.parse(row.config) as AnthropicConfigData;
  }

  public static async updateConfig(updates: Partial<AnthropicConfigData>): Promise<AnthropicConfigData> {
    const current = await AnthropicService.getConfig();
    const updated = { ...current, ...updates };
    const upsert = ConfigDB.prepare(`
      INSERT INTO settings (id, config)
      VALUES (?, jsonb(?)) ON CONFLICT(id) DO UPDATE SET config = jsonb(?)
    `);
    upsert.run('anthropic', JSON.stringify(updated));
    return updated;
  }

  public static async changeModel() {
    const querySingle = ConfigDB.prepare('SELECT id,config FROM settings WHERE id = ?');
    const anthropicConfig = querySingle.get('anthropic');
    if (!anthropicConfig) {
      const insert = ConfigDB.prepare('INSERT INTO settings (id, config) VALUES (?, jsonb(?))');
      insert.run('anthropic', JSON.stringify(defaultConfig));
      return defaultConfig;
    } else {
      return anthropicConfig;
    }
  }
}
