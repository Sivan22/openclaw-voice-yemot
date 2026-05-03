# AGENTS.md — instructions for AI agents working on this repo

This repo uses [changesets](https://github.com/changesets/changesets) for
versioning and publishing. **Every code-affecting commit must include a
changeset.** The release pipeline is automated; your only job is to record
*what changed* in a changeset file.

## When to add a changeset

Add a changeset for any change that affects users of the published npm
package — features, fixes, refactors that change behavior, dependency bumps
that cross a major boundary, etc.

You do **not** need a changeset for:
- README typos or comment-only edits
- Test-only changes
- CI / tooling changes that don't affect what's shipped (`.github/`,
  `eslint`, `tsconfig.build.json`, `.changeset/config.json`)
- Changes to files outside `dist/`, `index.ts`, `src/`, `openclaw.plugin.json`

If unsure, add one.

## How to add a changeset (non-interactive)

The `npm run changeset` CLI is interactive and not friendly to agents. Just
write the file directly:

```bash
cat > .changeset/$(openssl rand -hex 6).md <<'EOF'
---
"openclaw-voice-yemot": patch
---

One-line summary of the user-visible change.
EOF
```

**Bump levels:**

| Level | When | Example |
|---|---|---|
| `patch` | bug fix, doc tweak that ships, internal refactor with no API change | "Fix JSON-fence parsing for agent replies" |
| `minor` | new feature, new gateway method, new config option | "Add `voiceyemot.transcripts` gateway method" |
| `major` | breaking config schema change, removed export, changed default behavior | "Rename `agent.responseTimeoutMs` → `agent.timeoutMs`" |

The body is what lands in `CHANGELOG.md`, so write it for a human reader.
One sentence is fine; a few bullets if the change spans multiple things.

Commit the `.changeset/<slug>.md` file in the **same commit** as the code
change, or as a follow-up commit before pushing.

## What happens after you push

1. Push to `main`.
2. The `Release` workflow (`.github/workflows/release.yml`) runs typecheck +
   lint + tests, then invokes `changesets/action`.
3. If pending changesets exist, the action opens (or updates) a
   **"Version Packages"** pull request. That PR bumps `package.json`,
   prepends entries to `CHANGELOG.md`, and deletes the consumed
   `.changeset/<slug>.md` files.
4. When that PR is merged to `main`, the same workflow re-runs and this
   time it publishes the new version to npm.

You don't need to bump `package.json` or edit `CHANGELOG.md` manually —
`changesets/action` does that.

## Local verification

Before committing, you can sanity-check:

```bash
npx changeset status   # lists pending changesets and resulting bump
```

## Required GitHub repo secrets (one-time human setup)

For the Release workflow to publish, the repo must have these secrets:

- `NPM_TOKEN` — an npm automation token with publish rights to
  `openclaw-voice-yemot`. Generate at
  <https://www.npmjs.com/settings/<your-username>/tokens> (type:
  *Automation*) and add via GitHub → Settings → Secrets and variables →
  Actions.

`GITHUB_TOKEN` is provided automatically by Actions; no setup needed.
