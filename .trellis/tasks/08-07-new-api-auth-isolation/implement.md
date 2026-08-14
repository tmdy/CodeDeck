# Implementation plan

1. Add and normalize `SiteBalanceAuthKind` on account and draft types.
2. Update save/equality/cache invalidation for authentication-kind changes.
3. Add a shared single-transport resolver in `management-auth.ts`.
4. Refactor balance requests to use only the resolved explicit-account transport.
5. Refactor check-in and learned-path handling to use only that transport.
6. Update account-editor selection, labels, and help text.
7. Add migration, service, component, invalidation, error, and redaction tests.
8. Run `npm test`, `npm run typecheck`, `npm run build`, and `git diff --check`.

## Risks

- Preserve unrelated dirty-worktree changes.
- Do not alter Profile API-key launch behavior.
- Keep encrypted storage additive and backward compatible.
