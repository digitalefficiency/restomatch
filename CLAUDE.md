## graphify

This project can keep a knowledge graph of the code at graphify-out/ (god nodes, community structure, cross-file relationships), built by [Graphify](https://github.com/Graphify-Labs/graphify). The graph is **not committed** (graphify-out/ is git-ignored); build it in your checkout with `GRAPHIFY_BACKEND=none graphify update .` — code is parsed locally with tree-sitter (no LLM, no API cost, nothing leaves the machine). Cloud sessions get the pinned CLI from the SessionStart hook (`scripts/graphify-session-start.sh`); on a local machine run `uv tool install graphifyy==0.9.99` once. `/graphify .` (the skill in `.claude/skills/graphify/`) also adds docs and images, using the session's model.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- The graph is a navigation aid, never a source of truth: AGENTS.md, STATE.md and the code itself win. Graph edges tagged INFERRED are guesses; confirm them in the code before relying on them, and never cite the graph as evidence for a money, tenancy or security claim.
