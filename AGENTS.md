# Repository Guidelines

## Project Structure & Module Organization

Vox is a React 19, TypeScript, Vite, and Tauri v2 desktop application. Frontend code lives in `src/`: route-level screens are in `src/pages/`, reusable application components in `src/components/`, shadcn-style primitives in `src/components/ui/`, shared hooks in `src/hooks/`, native/database helpers in `src/lib/`, and Zustand state in `src/store/`. Static files belong in `public/`; imported images and other bundled assets belong in `src/assets/`.

Rust desktop code is under `src-tauri/src/`, with Tauri configuration and capabilities in `src-tauri/`. Release automation lives in `scripts/`, CI workflows in `.github/workflows/`, and updater artifacts in `release/`.

## Build, Test, and Development Commands

- `pnpm install` installs locked frontend and Tauri CLI dependencies.
- `pnpm desktop:dev` runs the full desktop application with hot reload.
- `pnpm dev` starts only the Vite frontend.
- `pnpm typecheck` validates TypeScript without emitting files.
- `pnpm lint` runs ESLint across the repository.
- `pnpm build` type-checks and creates the production web bundle.
- `cd src-tauri && cargo check` validates Rust code quickly.
- `pnpm desktop:build` creates platform-native production bundles.

Use Node.js 22 and pnpm 10 to match CI.

## Coding Style & Naming Conventions

Use TypeScript with two-space indentation, double quotes, semicolons, and functional React components. Name component files in kebab case (`settings-modal.tsx`), exported components in PascalCase, hooks with a `use` prefix, and utilities in camelCase. Prefer the `@/` alias for imports from `src/`. Keep shared UI primitives in `src/components/ui/`; place product-specific behavior outside that directory. Run `pnpm lint` before submitting. Format Rust with `cargo fmt` and follow standard snake_case naming.

## Testing Guidelines

No dedicated automated test suite is currently configured. Every change must pass `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `cargo check`. Manually verify affected desktop flows with `pnpm desktop:dev`, especially microphone permissions, global shortcuts, transcription, SQLite persistence, and updater behavior. Add focused tests alongside new logic when introducing a test framework.

## Commit & Pull Request Guidelines

History follows Conventional Commits such as `feat:`, `fix:`, and `chore:`. Keep commits focused and use imperative summaries. Pull requests should explain the behavior change, list verification performed, link related issues, and include screenshots or recordings for UI changes. Call out platform-specific behavior and configuration changes explicitly.

## Security & Configuration

Copy `.env.example` for local configuration. Never commit secrets, signing keys, DSNs, downloaded models, generated `dist/` output, or `src-tauri/target/` artifacts. The pre-commit hook runs `pnpm version:check`; keep package, Cargo, and Tauri versions synchronized.
