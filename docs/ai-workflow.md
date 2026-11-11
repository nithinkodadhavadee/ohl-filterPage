# AI-assisted development workflow

This repository was built with a repeatable, documentation-first workflow. This
document explains the flow, the artifacts it produces, and where each kind of
decision belongs. It is for maintainers and contributors who want to continue the
same process — with or without an AI assistant.

## Skills used

The workflow is driven by a set of skills installed outside this repository (on
the maintainer's machine under `~/.agents/skills`). They are not vendored here.

| Skill | Role |
| --- | --- |
| `grill-with-docs` | Runs `grilling` + `domain-modeling`: relentless questioning, updating `CONTEXT.md` and ADRs as decisions land. |
| `grilling` | The interview primitive: rounds, a frontier of questions, facts found by the agent, decisions made by the human. |
| `domain-modeling` | Sharpens the glossary, challenges fuzzy terms, records durable decisions as ADRs. |
| `to-spec` | Synthesises the conversation into a spec; no new interview. |
| `to-tickets` | Breaks the spec into tracer-bullet tickets with blocking edges. |
| `implement-spec` | Creates a branch, runs implementer subagents in worktrees, merges, runs code review. |
| `code-review` | Two-axis review: Standards (repo conventions) and Spec (does it implement the ticket/spec). |
| `setup-matt-pocock-skills` | One-time repository configuration for the tracker, triage labels and domain docs. |
| `triage` | Optional: moves raw incoming issues through the triage states. |

If you move the tracker to GitHub or GitLab, update
[`docs/agents/issue-tracker.md`](agents/issue-tracker.md) and
[`triage-labels.md`](agents/triage-labels.md); the skills read those files.

## Artifact map

| Artifact | Contents | Owner |
| --- | --- | --- |
| `CONTEXT.md` | Domain glossary only. No implementation detail. | `domain-modeling` |
| `docs/adr/NNNN-*.md` | Durable, hard-to-reverse decisions and their trade-offs. | `domain-modeling` |
| `.scratch/catalogue-discovery/spec.md` | Product spec and decision record, per pass. | `to-spec` |
| `.scratch/catalogue-discovery/issues/NN-*.md` | Executable tickets: what, blockers, status, acceptance. | `to-tickets` |
| `.scratch/catalogue-discovery/STATUS.md` | Human index of done versus pending. | maintainer |
| `.scratch/catalogue-discovery/BACKLOG.md` | Unscheduled ideas. **Not tickets.** | maintainer |
| `docs/agents/` | Tracker, triage-label and domain-doc configuration. | `setup-matt-pocock-skills` |
| `docs/operations.md` | Commands, env vars, data paths, lifecycle. | `implement-spec` / maintainer |
| `docs/docker.md` | Docker, deployment, data migration, Funnel. | `implement-spec` / maintainer |
| `README.md` | Orientation and quick start. | maintainer |
| `CONTRIBUTING.md` | Local setup, tests and contribution rules. | maintainer |

**Rule:** do not duplicate a decision in several places. Put it where the table
says; link to it elsewhere.

## The pass model

Work is organised in **passes**. A pass is a coherent batch of tickets that ends
with a review and a status update.

- **v1** — prototype: scrape, browse, search, filter, enrich.
- **Pass 2** — UX and trust: permalinks, badges, collapsible filters, source hints.
- **Pass 3** — production shape: configurable Crawl set, Hidden books, startup
  catch-up, scheduled scans, Snapshots, infinite scroll, container.
- **Pass 4** — trust and observability: multi-author filter, run log, enrichment
  status, source link, sweep completion and the `/status` page.
- **Pass 5** — planned: back-to-top, header link, audit review, copy-link
  decision, remove the unswept message, low-sample default.

Tickets are numbered globally (`01` onward) and never reused. The spec records
each pass; `STATUS.md` records what is done.

## Workflow

### 1. Grill the idea

Use `grill-with-docs` when the idea is fuzzy. It asks questions in rounds,
challenges vocabulary, and writes resolved terms to `CONTEXT.md` and durable
decisions to ADRs. Do not write code yet.

Output: updated `CONTEXT.md`, possibly an ADR, and a shared understanding.

### 2. Write the spec

Use `to-spec` to synthesise the conversation into the spec. It does not
interview; it records problem, solution, user stories, implementation decisions,
testing seams, and out-of-scope. Publish it to the configured tracker.

Output: `.scratch/catalogue-discovery/spec.md`.

### 3. Break it into tickets

Use `to-tickets` to create tracer-bullet tickets with blocking edges. Each ticket
must be demoable or verifiable on its own and fit in one working session. The
result is a graph, not a list: the **frontier** is every unblocked ticket.

Output: `.scratch/catalogue-discovery/issues/NN-*.md`.

### 4. Implement

Use `implement-spec` for a whole pass, or `/implement` for a single ticket.

`implement-spec`:

1. Creates `feat/<feature>-passN` from the previous pass.
2. For each frontier ticket, creates a worktree and branch (`pN/<ticket>`) and
   runs an implementer subagent with pointers to the spec, ticket, ADRs and
   previous commits.
3. Merges each branch into the pass branch, resolving conflicts.
4. Recomputes the frontier and starts more implementers.
5. Runs `/code-review` on the pass diff (Standards + Spec).
6. Fixes review findings in one implementer pass.
7. Updates ticket statuses and `STATUS.md`, then cleans up worktrees.

If there is no remote, the pass branch is the deliverable; otherwise open a PR.
In this repository the passes were local branches; `main` now holds the history.

### 5. Review

`/code-review` compares the pass against the previous pass, not against `main`,
so the review only sees the new work. Standards reviews check repo conventions
and documented standards; Spec review checks the ticket and spec. Findings are
fixed in a single follow-up branch, then merged.

### 6. Record

- Set each ticket's `Status` and tick the acceptance criteria you verified.
- Update `STATUS.md`.
- Add unscheduled ideas to `BACKLOG.md`, never as tickets.
- Update `docs/operations.md` or `docs/docker.md` when commands or deployment
  change.

## Ticket conventions

A ticket file has:

```markdown
# NN: Title

**What to build:** the end-to-end behaviour.

**Blocked by:** ticket numbers, or "None (can start immediately)".

**Status:** ready-for-agent

- [ ] Acceptance criterion
```

- Triage states: `needs-triage`, `needs-info`, `ready-for-agent`,
  `ready-for-human`, `wontfix`.
- Completion states used here: `done (pass N)`, `done (pass N follow-up)`, and
  `superseded by …`.
- The `Status` line is the authoritative state. Acceptance checkboxes are the
  contract; tick them when verified. (Some older v1 tickets only had their status
  updated — treat the status line as the source of truth for historical work.)
- **Backlog items are not tickets.** They live in `BACKLOG.md` so they do not
  appear in every pass. Create a ticket only when the item is scheduled.

## Branch and cleanup conventions

- Pass branch: `feat/catalogue-discovery-passN`.
- Ticket branches: `pN/<ticket>`; code-review fixes: `pN/review-fixes`.
- Worktrees live outside the repository, under the assistant's temporary
  directory.
- After merging a pass into `main`, delete merged branches. Their commits remain in
  `main`'s history; the branch name adds nothing. Keep only `main`.
- Release history is the pass sections in the spec and the commits on `main`;
  ticket branches are disposable.

## How to answer “what is left?”

1. Read `STATUS.md` for done versus pending.
2. List open ticket files and their `Status` lines; `ready-for-agent` are
   candidates.
3. Check `Blocked by` to find the frontier.
4. Read `BACKLOG.md` for unscheduled ideas, but do not treat them as planned work.

## Documentation rules

- Use the glossary's vocabulary in specs, tickets, tests and UI copy.
- Do not put file paths, line numbers or code snippets in the spec; they go stale.
- An ADR is warranted only when a decision is hard to reverse, surprising without
  context, and the result of a real trade-off.
- Keep the spec at the decision level; exact API shapes and schema live in the
  tickets and code.
- Update the operations or Docker guide in the same change as the command or
  deployment behaviour.

## Using this workflow without an AI assistant

Nothing above depends on the skills. A human can:

1. Interview themselves or the maintainer and write `CONTEXT.md`/ADRs.
2. Write or update the spec.
3. Create one ticket file per slice with blocking edges.
4. Work the frontier, run the checks, and update the statuses.
5. Review the diff against the spec and conventions.
6. Record the result in `STATUS.md` and `BACKLOG.md`.

The skills automate the interviewing, splitting, worktrees and review; the
artifacts and the rules are the same.
