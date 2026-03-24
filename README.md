<div align="center">
  <h1>IrisCode</h1>
  <p><strong>Model-agnostic AI coding agent CLI</strong></p>
  <p>
    Terminal-first coding agent with a real permission engine, diff review,
    memory, MCP, and an extensibility layer built around skills, plugins, and hooks.
  </p>
  <p>
    <img alt="Bun" src="https://img.shields.io/badge/bun-1.3%2B-f7f3e8?logo=bun&logoColor=111111">
    <img alt="TypeScript" src="https://img.shields.io/badge/typescript-5.x-3178c6?logo=typescript&logoColor=white">
    <img alt="Ink" src="https://img.shields.io/badge/ink-terminal_ui-111827">
    <img alt="MCP" src="https://img.shields.io/badge/MCP-enabled-2563eb">
    <img alt="Extensible" src="https://img.shields.io/badge/extensible-skills%20plugins%20hooks-4b5563">
  </p>
</div>

<p align="center">
  <code>default</code>
  <code>acceptEdits</code>
  <code>plan</code>
  <code>/skills</code>
  <code>/plugins</code>
  <code>/mcp</code>
  <code>run</code>
  <code>--mcp</code>
</p>

<pre align="center">
model: anthropic/claude-sonnet-4-6 | mode: plan (dry run) | memory: 4,812/10,000 tokens
MCP: github (14 tools)
Skills: 6 | Plugins: 2 (8 commands, 6 skills, 3 hooks) | MCP: 1 server
</pre>

## What IrisCode Does

IrisCode runs as an interactive terminal UI or a one-shot CLI. It can inspect a codebase, call tools, ask for permission when the action is risky, show diffs before edits, connect to MCP servers, and extend itself with local project logic.

The core design goal is straightforward: keep the agent useful without pretending the terminal is magic. Permissions, memory, context budget, model selection, and extensibility are all visible parts of the system.

## Highlights

| Area | What it gives you |
| --- | --- |
| Multi-provider models | OpenAI, Anthropic, Google, Cohere, Ollama, and OpenAI-compatible providers |
| Safer execution | Permission tiers, blocked and allowed tool rules, plan mode, and diff review |
| Real extensibility | `SKILL.md` skills, plugin bundles, shell-based hooks, and MCP server integration |
| Stateful sessions | Saved sessions, persistent memory, compaction, and startup context summaries |
| Terminal-first workflow | Ink-based REPL, slash commands, command palette, model picker, and activity panel |
| Scriptable mode | `iriscode run "..."` for one-shot execution and `iriscode --mcp` for MCP server mode |

## Quick Start

### 1. Install dependencies

```bash
bun install
```

### 2. Configure a model provider

Use your project config, global `~/.iris/config.toml`, or environment variables for the provider you want to use.

### 3. Start the interactive UI

```bash
bun run dev
```

### 4. Or run a single prompt

```bash
bun run src/cli/index.tsx run "Summarize the architecture of this repository"
```

## Useful Commands

- `/models` switches or inspects configured models.
- `/mcp` manages MCP servers and connected MCP tools.
- `/skills` browses, runs, creates, and inspects skills.
- `/plugins` installs, activates, removes, and browses plugins.
- `/memory` manages project and global memory files.
- `/init` regenerates `IRIS.md` from the repository and session context.
- `/diff`, `/tools`, `/sessions`, and `/cost` expose the current runtime state.
- `/<skill-name>` is created automatically for every discovered skill.

Example:

```text
/frontend-design build a landing page for the new dashboard
```

That command loads the `frontend-design` skill and immediately continues with the rest of the prompt.

## Extensibility Layout

IrisCode loads extensibility from both global and project scopes.

```text
~/.iris/
  skills/
  plugins/
  hooks/

.iris/
  skills/
  plugins/
  hooks/
```

### Skills

Skills are prompt templates stored as folders with a `SKILL.md` file. They can inject instructions into the conversation, pre-approve tools for the current turn, and optionally request a one-shot model override.

```text
my-skill/
  SKILL.md
  scripts/
  references/
  assets/
```

### Plugins

Plugins are distribution bundles. A plugin can ship custom commands, agents, skills, hooks, and MCP configuration in one folder.

```text
my-plugin/
  .iris-plugin/plugin.json
  commands/
  agents/
  skills/
  hooks/
  .mcp.json
```

### Hooks

Hooks are shell scripts triggered by tool and lifecycle events. They can inspect inputs, block actions, modify tool input, or post-process results.

## Development

```bash
bun test
bun run typecheck
```

## Project Structure

```text
src/
  agent/        Agent loop, session state, orchestration
  cli/          Entry points and non-interactive commands
  commands/     Slash commands and command registry
  config/       Config loading, schema, secrets, watchers
  hooks/        Hook registry, loader, and runner
  mcp/          MCP client, server, registry, and transport bridge
  memory/       Memory loading, retrieval, compaction, persistence
  plugins/      Plugin manifest loading, activation, installation
  skills/       Skill loader, injector, and Skill meta-tool
  tools/        File, shell, git, search, orchestration, MCP tools
  ui/           Ink UI components, input routing, and services
```

## Why This Exists

Most agent CLIs stop at "call a model and run a shell command." IrisCode pushes further on the pieces that matter once you use the tool for real work: permissions, extensibility, repeatability, and operator visibility.

If you want a coding agent that can be shaped by project-local behavior instead of only prompt text, this repository is the point.
