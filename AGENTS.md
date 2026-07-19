# Repository Guidelines

## Project Structure & Module Organization

CodeDeck is an Electron desktop app with a React/Vite renderer. The main UI entry points live in `src/main.tsx`, `src/App.tsx`, and `src/TerminalApp.tsx`. Reusable renderer components are under `src/components/`, while shared business logic, services, providers, crypto helpers, and testable utilities live under `src/shared/`. Electron main-process and preload code are in `electron/`. Static assets are split between `public/` and `src/assets/`; packaging resources are in `build/`. Documentation is in `docs/`. Treat `dist/`, `dist-electron/`, `release/`, `node_modules/`, and local runtime data under `app-data/` as generated or environment-specific.

## Build, Test, and Development Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: run Vite, watch Electron TypeScript, and launch Electron.
- `npm run dev:renderer`: start only the Vite renderer on port `5173`.
- `npm run build:electron`: compile Electron main/preload code to `dist-electron/`.
- `npm run typecheck`: run TypeScript checks for renderer and Electron configs.
- `npm test`: run Vitest once.
- `npm run test:watch`: run Vitest in watch mode.
- `npm run build`: typecheck, build the renderer, then compile Electron.
- `npm run dist:win`: build a Windows NSIS installer in `release/`.
- `npm run rebuild:native`: rebuild `node-pty` if Electron ABI errors occur.

## Coding Style & Naming Conventions

Use TypeScript and React functional components. Follow the existing two-space indentation, double quotes, semicolons, and explicit exported types/interfaces where useful. Keep component files in PascalCase, such as `ProfileEditForm.tsx`; utility and service modules use kebab-case, such as `profile-service.ts`. Test files should mirror the target module name and end in `.test.ts` or `.test.tsx`.

## Testing Guidelines

Vitest is configured in `vite.config.ts` with a Node environment and includes `src/shared/**/*.test.ts` and `src/shared/**/*.test.tsx`. Place unit tests near shared logic or under `src/shared/__tests__/` for grouped component/service coverage. Run `npm test` before submitting changes; run `npm run typecheck` for changes that touch types, IPC contracts, or service APIs.

## Commit & Pull Request Guidelines

Recent commits use short, imperative subjects, often with prefixes like `feat:`, `fix:`, or `merge:`. Keep the first line focused, for example `fix: constrain lazy page loading layout`. Pull requests should explain the user-visible change, list validation commands run, link related issues when available, and include screenshots or short recordings for UI changes.

## Security & Configuration Tips

Do not commit secrets, tokens, generated logs, or local workspace contents from `app-data/` and `library/`. Use `CODEDECK_PROJECT_ROOT` only for local workspace overrides, and document any new environment variables in `README.md`.
