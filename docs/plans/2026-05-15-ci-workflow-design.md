# CI Workflow Design

## Summary

Add a separate GitHub Actions CI workflow for normal validation on pushes and pull requests. The workflow should run quickly, stay independent from release publishing, and avoid known pre-existing lint failures.

## Goals

- Validate core frontend and TypeScript health on normal development changes.
- Keep release publishing isolated from everyday CI.
- Provide a green baseline workflow that is usable immediately.

## Non-Goals

- Running lint while known unrelated lint issues remain unresolved.
- Building and packaging the full desktop application in normal CI.
- Replacing the release workflow.

## Approach Options

### Option 1: Merge validation into the release workflow

Trade-offs:
- Fewer workflow files.
- Conflates validation with release publishing and slows release runs.

### Option 2: Full desktop CI on every push and PR

Trade-offs:
- Stronger coverage.
- More expensive and slower than needed for a first normal CI workflow.

### Option 3: Focused frontend and typecheck CI

Trade-offs:
- Fast, simple, and immediately actionable.
- Does not validate Tauri packaging.

Recommended: Option 3.

## Design

### Workflow File

Add `.github/workflows/ci.yml`.

Triggers:
- `push`
- `pull_request`

Runner:
- `ubuntu-latest`

### Steps

1. Check out the repository.
2. Install pnpm and Node.
3. Install dependencies with `pnpm install --frozen-lockfile`.
4. Run `pnpm typecheck`.
5. Run `pnpm build`.

### Exclusions

- Skip `pnpm lint` for now because the repository has known pre-existing lint failures unrelated to the release workflow work.

### Documentation

Update release/update documentation with a short note that:
- `ci.yml` handles normal validation
- `release.yml` handles tagged/manual publishing

## Verification

- Review the workflow YAML after creation.
- Keep validation limited to workflow-file inspection from the local workspace.
