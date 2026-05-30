# Slack Message to Manager

---

Hey — wanted to give you a quick heads up on something I built on the side that's been making the AI-assisted dev workflow significantly faster.

Since I've been running multiple Claude Code sessions in parallel across different worktrees, the bottleneck wasn't the agents themselves — it was me manually checking which one needed attention. Switching terminals, reading output, figuring out if something finished 5 minutes ago. A lot of invisible overhead.

So I built a native macOS tool to solve that: a split terminal multiplexer + live agent state monitor. All the worktrees are visible at once, Claude reports its state back to the dashboard via hooks, and I can jump between sessions without touching the mouse.

The main things it does:
- Split terminal view with keyboard shortcuts for instant context switching (Ctrl+1/2/3)
- Real-time Claude state — terminals glow when an agent is done or blocked, so I never need to check manually
- Task context on each terminal — what Claude was asked to do and what it's currently doing, visible without switching windows
- Cmd+O focuses the right VS Code window from anywhere in the app

The part I find most useful: whenever I hit friction in the workflow, I treat it as a signal and add a feature. The tool has gotten progressively better just from real daily use.

Happy to demo it if you're curious. Also thinking about whether any of this pattern is worth formalising for the wider team.

— Srek
