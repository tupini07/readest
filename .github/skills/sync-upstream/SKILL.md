---
name: sync-upstream
description: Guide for syncing this fork with the upstream Readest repository. Use this when asked to sync, pull, merge, or update from upstream.
---

# Syncing with Upstream

This repository is a personal fork of Readest. The upstream remote points to the original project.

## Remote Layout

| Remote     | URL                                      | Purpose            |
|------------|------------------------------------------|---------------------|
| `origin`   | `https://github.com/tupini07/readest.git` | This fork          |
| `upstream` | `https://github.com/readest/readest.git`  | Original project   |

## Branch Strategy

- **`main`** tracks upstream's `main` — it should stay in sync with upstream and only contain fork infrastructure (e.g. `release-android.yml` on `main` because GitHub requires `workflow_dispatch` workflows on the default branch).
- **`hardcover-sync`** is the working branch with all custom fork changes (Readeck integration, UI tweaks, etc.).

## Sync Procedure

1. **Fetch upstream:**
   ```bash
   git fetch upstream
   ```

2. **Update `main` to match upstream:**
   ```bash
   git checkout main
   git pull --no-rebase upstream main --no-edit
   git push origin main
   ```

3. **Merge updated `main` into the working branch:**
   ```bash
   git checkout hardcover-sync
   git merge main --no-edit
   ```

4. **Resolve conflicts if any**, then:
   ```bash
   git push origin hardcover-sync
   ```

## Important Notes

- Always use `--no-rebase` when pulling from upstream to preserve merge history.
- Use `--no-edit` to avoid interactive editor prompts for merge commit messages.
- After syncing, build and test (`task build-android-debug`) before pushing to verify nothing broke.
- The `workflow_dispatch` trigger for `release-android.yml` must exist on `main` to be triggerable via `gh workflow run`, even when targeting another branch with `--ref`.

## Taskfile Shortcut

```bash
task sync-upstream
```

This runs `git fetch upstream && git merge upstream/main --no-edit` on the current branch.
