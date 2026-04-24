import fs from './fileSystem';

export type ClaudeCommandSource = 'builtin' | 'workspace' | 'user' | 'plugin';

export interface ClaudeCommand {
  id: string;
  /** "/name" or "/plugin:name" */
  label: string;
  description: string;
  source: ClaudeCommandSource;
  /** Plugin name when source === 'plugin'; undefined otherwise. */
  pluginName?: string;
  /** Absolute path to the command's source .md file, or empty string if unknown. */
  path: string;
  /** Template inserted into the chat input when picked. */
  template: string;
}

interface ProbeResult {
  slashCommands?: string[];
  plugins?: Array<{ name: string; path: string; source?: string }>;
  skills?: string[];
  error?: string;
}

function extractDescription(content: string): string {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const desc = fm[1].match(/^description:\s*(.+)$/m);
    if (desc) return desc[1].trim().replace(/^['"]|['"]$/g, '');
  }
  const body = content.replace(/^---\n[\s\S]*?\n---\s*/, '').trim();
  const firstLine = body.split('\n').find(line => line.trim().length > 0) ?? '';
  return firstLine.replace(/^#+\s*/, '').trim().slice(0, 140);
}

async function readFileSafe(path: string): Promise<string | null> {
  try { return await fs.readFile(path); } catch { return null; }
}

async function dirExists(path: string): Promise<boolean> {
  if (window.electronAPI?.pathExists) {
    try { return await window.electronAPI.pathExists(path); } catch { return false; }
  }
  // Browser mode: best-effort via readDirectory.
  try { await fs.readDirectory(path); return true; } catch { return false; }
}

async function getHomeDir(): Promise<string | null> {
  if (window.electronAPI?.getHomeDir) {
    try { return await window.electronAPI.getHomeDir(); } catch { return null; }
  }
  return null;
}

function takesArg(name: string): boolean {
  return /^(model|add-dir|review|frame|init|agents|hooks|mcp)$/.test(name)
    || name.endsWith(':teach-me')
    || name.endsWith(':quiz-me')
    || name.endsWith(':ce-plan')
    || name.endsWith(':ce-brainstorm')
    || name.endsWith(':ce-review');
}

function makeCommand(
  name: string,
  info: { description: string; path: string; source: ClaudeCommandSource; pluginName?: string },
): ClaudeCommand {
  const label = `/${name}`;
  return {
    id: `${info.source}:${name}`,
    label,
    description: info.description,
    source: info.source,
    pluginName: info.pluginName,
    path: info.path,
    template: takesArg(name) ? `${label} ` : label,
  };
}

async function resolveCommand(
  name: string,
  plugins: Array<{ name: string; path: string }>,
  workspacePath: string | null,
  homeDir: string | null,
): Promise<{ description: string; path: string; source: ClaudeCommandSource; pluginName?: string }> {
  if (name.includes(':')) {
    const [pluginName, rest] = name.split(':', 2);
    const plugin = plugins.find(p => p.name === pluginName);
    if (plugin) {
      const cmdPath = `${plugin.path.replace(/\/+$/, '')}/commands/${rest}.md`;
      const skillPath = `${plugin.path.replace(/\/+$/, '')}/skills/${rest}/SKILL.md`;
      for (const p of [cmdPath, skillPath]) {
        const content = await readFileSafe(p);
        if (content !== null) {
          return { description: extractDescription(content), path: p, source: 'plugin', pluginName };
        }
      }
    }
    return { description: '', path: '', source: 'plugin', pluginName };
  }

  const candidates: Array<{ path: string; source: ClaudeCommandSource }> = [];
  if (workspacePath) {
    const root = workspacePath.replace(/\/+$/, '');
    candidates.push({ path: `${root}/.claude/commands/${name}.md`, source: 'workspace' });
    candidates.push({ path: `${root}/.claude/skills/${name}/SKILL.md`, source: 'workspace' });
  }
  if (homeDir) {
    const root = homeDir.replace(/\/+$/, '');
    candidates.push({ path: `${root}/.claude/commands/${name}.md`, source: 'user' });
    candidates.push({ path: `${root}/.claude/skills/${name}/SKILL.md`, source: 'user' });
  }
  for (const c of candidates) {
    const content = await readFileSafe(c.path);
    if (content !== null) {
      return { description: extractDescription(content), path: c.path, source: c.source };
    }
  }
  return { description: '', path: '', source: 'builtin' };
}

/**
 * Primary path: ask Claude Code via its init-event probe. Returns [] if the
 * probe is unavailable or errors out — the caller falls back to a filesystem
 * scan.
 */
async function loadViaProbe(workspacePath: string | null, homeDir: string | null): Promise<ClaudeCommand[]> {
  const api = window.electronAPI;
  if (!api?.claudeListSlashCommands) return [];

  let probe: ProbeResult;
  try {
    probe = await api.claudeListSlashCommands(workspacePath ?? undefined);
  } catch (err) {
    console.warn('[claudeCommands] probe threw:', err);
    return [];
  }
  if (probe.error) {
    console.warn('[claudeCommands] probe reported error:', probe.error);
    return [];
  }
  if (!probe.slashCommands || probe.slashCommands.length === 0) return [];

  const plugins = probe.plugins ?? [];
  const resolved = await Promise.all(
    probe.slashCommands.map(async (name) => {
      const info = await resolveCommand(name, plugins, workspacePath, homeDir);
      return makeCommand(name, info);
    }),
  );
  return resolved;
}

/**
 * Fallback: discover commands by scanning the filesystem directly. Used when
 * the probe isn't available (browser mode, stale preload, missing binary).
 * Covers workspace `.claude/commands/`, user `~/.claude/commands/`, and every
 * plugin listed in `installed_plugins.json` (both `commands/` and `skills/`).
 */
async function loadViaFilesystem(workspacePath: string | null, homeDir: string | null): Promise<ClaudeCommand[]> {
  const out: ClaudeCommand[] = [];

  const readCommandsIn = async (dir: string, source: ClaudeCommandSource, pluginName?: string) => {
    if (!(await dirExists(dir))) return;
    let entries;
    try { entries = await fs.readDirectory(dir); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory) continue;
      if (!e.name.toLowerCase().endsWith('.md')) continue;
      const base = e.name.replace(/\.md$/i, '');
      const name = pluginName ? `${pluginName}:${base}` : base;
      const content = await readFileSafe(e.path);
      const description = content ? extractDescription(content) : '';
      out.push(makeCommand(name, { description, path: e.path, source, pluginName }));
    }
  };

  const readSkillsIn = async (dir: string, source: ClaudeCommandSource, pluginName?: string) => {
    if (!(await dirExists(dir))) return;
    let entries;
    try { entries = await fs.readDirectory(dir); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory) continue;
      const skillFile = `${e.path.replace(/\/+$/, '')}/SKILL.md`;
      const content = await readFileSafe(skillFile);
      if (content === null) continue;
      const name = pluginName ? `${pluginName}:${e.name}` : e.name;
      const description = extractDescription(content);
      out.push(makeCommand(name, { description, path: skillFile, source, pluginName }));
    }
  };

  if (workspacePath) {
    const root = workspacePath.replace(/\/+$/, '');
    await readCommandsIn(`${root}/.claude/commands`, 'workspace');
    await readSkillsIn(`${root}/.claude/skills`, 'workspace');
  }
  if (homeDir) {
    const root = homeDir.replace(/\/+$/, '');
    await readCommandsIn(`${root}/.claude/commands`, 'user');
    await readSkillsIn(`${root}/.claude/skills`, 'user');

    // Plugins.
    const manifest = await readFileSafe(`${root}/.claude/plugins/installed_plugins.json`);
    if (manifest) {
      try {
        const parsed = JSON.parse(manifest) as { plugins?: Record<string, Array<{ installPath?: string }>> };
        if (parsed.plugins) {
          for (const [key, entries] of Object.entries(parsed.plugins)) {
            const pluginName = key.split('@')[0];
            if (!pluginName || !Array.isArray(entries)) continue;
            for (const entry of entries) {
              if (typeof entry.installPath !== 'string' || !entry.installPath) continue;
              const base = entry.installPath.replace(/\/+$/, '');
              await readCommandsIn(`${base}/commands`, 'plugin', pluginName);
              await readSkillsIn(`${base}/skills`, 'plugin', pluginName);
            }
          }
        }
      } catch (err) {
        console.warn('[claudeCommands] failed to parse installed_plugins.json:', err);
      }
    }
  }
  return out;
}

/**
 * Load slash commands dynamically. Uses Claude Code's own init-event probe as
 * the authoritative source when available; falls back to a filesystem scan so
 * the popover still shows something in browser mode or before the Electron
 * preload picks up the new IPC.
 */
export async function loadClaudeCommands(workspacePath: string | null): Promise<ClaudeCommand[]> {
  const homeDir = await getHomeDir();

  const viaProbe = await loadViaProbe(workspacePath, homeDir);
  const viaFs = await loadViaFilesystem(workspacePath, homeDir);

  // Merge: probe entries win (authoritative), filesystem fills any gaps.
  const byLabel = new Map<string, ClaudeCommand>();
  for (const cmd of viaFs) byLabel.set(cmd.label, cmd);
  for (const cmd of viaProbe) byLabel.set(cmd.label, cmd);

  return Array.from(byLabel.values()).sort((a, b) => {
    // Plugin-prefixed commands group at the bottom.
    const aHasColon = a.label.includes(':');
    const bHasColon = b.label.includes(':');
    if (aHasColon !== bHasColon) return aHasColon ? 1 : -1;
    return a.label.localeCompare(b.label);
  });
}
