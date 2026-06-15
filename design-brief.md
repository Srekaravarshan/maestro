# Design Brief — Developer Workflow Friction

You are a senior Product Manager / UX Director being asked to audit a developer's workflow and produce a clear product direction to eliminate friction. Read this carefully before responding.

---

## Who this developer is

Full-stack developer at SurveySparrow (a SaaS company). Works on the main product `app-v1` — a large Rails + React monolith with multiple sub-services (client, server, WDS, analyze server, EUI backend). Uses Claude Code AI agents extensively to parallelize work across multiple git worktrees.

---

## Current physical setup

- **MacBook display** (center): monitoring dashboard
- **Left external monitor**: multiple VS Code windows, each full-screened in its own macOS Space
- **Right external monitor**: Firefox full-screened with all browser tabs

---

## Current toolstack and what each tool does

| Tool | Purpose | Where it lives |
|---|---|---|
| **VS Code** | Code editing. One window per worktree, each full-screened | Left monitor |
| **Warp** | Service terminals — `rails server`, `npm run dev`, WDS, etc. | Right monitor or MacBook |
| **Maestro** (custom built) | Claude Code agent sessions, one terminal per worktree | MacBook display |
| **Firefox** | Testing the running app | Right monitor |
| **tmux/tmuxinator** | Persistent service sessions (just started using) | Inside Warp |

---

## What a typical workday looks like

1. Developer is working on 2-3 features in parallel, one per git worktree
2. For each worktree, they run: a Rails backend, a webpack dev server (WDS), a client dev server, sometimes an analyze server — all on different ports
3. They run a Claude Code session in Maestro for each active worktree
4. They test their features in Firefox tabs
5. They context-switch between features throughout the day

**Example: on a given day they might have:**
- `worktree1` → feature A → port 8080 → VS Code Space 2 → Firefox tab 1
- `worktree2` → feature B → port 8181 → VS Code Space 3 → Firefox tab 3
- `bug` branch → hotfix → port 8282 → VS Code Space 4 → Firefox tab 5

---

## The specific frictions (the developer's words)

1. **Warp vs Maestro look the same.** Both are dark terminal UIs. I open the wrong one constantly. I can't tell at a glance which one I'm in and what it's for.

2. **Port chaos.** I'm running the same application on 3 different ports. Port 8080, 8181, 8282. Which one is for which feature? I have to mentally map port → worktree → feature every time. After a context switch I forget.

3. **Browser tab confusion.** Firefox has 10+ tabs open. Which tab maps to which worktree? I have to read the URL or the page content to figure out which feature I'm looking at. There's no visual link between the tab and the worktree.

4. **VS Code window hunting.** 4 VS Code windows full-screened in different Spaces. Swiping to find the right one. I built a `Cmd+O` shortcut in Maestro that focuses VS Code for the active terminal — but only works if I'm already in the right Maestro terminal.

5. **Maestro itself is confusing to position.** It was built as a monitoring dashboard (peripheral, always visible), but now it also contains terminals. So it's half-monitor, half-workspace. I'm not sure whether to look at it constantly or only when notified.

6. **Claude agents vs service terminals in the same mental space.** My Claude sessions (AI work) and my service terminals (infra work) feel like they should be separate concerns but they're currently mixed in similar-looking UIs.

---

## What has been tried

- **Color-coding VS Code windows** per branch using `.vscode/settings.json` — the title bar and activity bar change color. Helped but requires memory.
- **Claude Code hooks** that write state to files, which Maestro reads and glows terminals when attention is needed — good for Claude sessions, doesn't help with service confusion.
- **tmuxinator** for service terminals inside Warp — just started, haven't felt the benefit yet.
- **`Cmd+O` shortcut** in Maestro to jump to the right VS Code window — works but only solves one direction of the problem.
- **Maestro sidebar** shows worktree list with git status and Claude state — good but doesn't show service port health clearly.

---

## The core design question

**How should a developer's physical and digital workspace be structured when they are running 2-3 parallel features, each requiring: AI agent session + multiple services + a browser view + a code editor?**

Specifically:
1. What is the right mental model / metaphor that unifies these elements?
2. What is the minimum set of "things" the developer needs to see at any given moment?
3. How do you create a clear identity for each "workspace" (worktree + its services + its browser view) so context switching is instant and unambiguous?
4. What should Maestro's scope be — pure AI agent monitor, or something broader?
5. Is there a better physical layout across 3 monitors?

---

## Constraints

- Organisation only allows Claude (Anthropic API) — no Cursor, no Copilot
- macOS only
- The developer is open to changing habits, tools, and layout
- Already built Maestro (Tauri + Rust + React) — can be extended or refocused
- tmux/tmuxinator already installed
- Budget: none — only existing subscriptions (Anthropic API, VS Code, Warp free tier)

---

## What we want from you

Produce a **product direction** that:

1. **Names and frames the core problem** in one sentence
2. **Proposes a clear mental model** for how a developer should think about their multi-worktree workspace
3. **Recommends what each tool should own** (what Warp does, what Maestro does, what VS Code does, what the browser does) with zero overlap
4. **Proposes a physical layout** across 3 monitors that reduces cognitive load
5. **Identifies the 3 highest-leverage changes** the developer could make this week to reduce friction — ordered by impact
6. **Identifies what Maestro should become** — its revised scope, one clear job, and what features to add or remove

Be direct. If the current approach is wrong, say so. Don't hedge.
