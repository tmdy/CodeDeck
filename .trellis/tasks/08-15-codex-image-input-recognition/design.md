# Design: align Profile browsing with browser-account partitions

## Boundaries

Keep credential ownership in Electron main. Renderer describes only the intended browser target; it never receives an opaque partition name, pending reference, Cookie, Token, or storage data.

The change spans four existing boundaries:

1. `App.tsx` derives an explicit open target from the current saved/new/auto/PAT draft.
2. Preload and IPC carry a small discriminated request contract.
3. Electron main resolves that request to a validated partition.
4. `PendingBrowserAccountReferenceRegistry` prepares and retains a tentative new-account reference before the actual login operation.

`BrowserAccountSessionManager` legacy identity verification remains unchanged.

## Open target contract

Use a discriminated request shape conceptually equivalent to:

```typescript
type ProfileBrowserTarget =
  | { kind: "default" }
  | { kind: "saved_session"; session_id: string }
  | { kind: "browser_slot"; slot: number }
  | { kind: "pending_browser_account" };
```

- `saved_session` resolves the saved account and existing partition.
- `browser_slot` resolves an existing global identity slot and its opaque reference.
- `pending_browser_account` asks main to prepare/reuse a tentative reference for the normalized Base URL.
- `default` uses the existing dedicated Profile browser partition.

Main validates every request. Invalid slot/session/origin combinations fail closed and never fall back to `default`.

## Pending reference lifecycle

Add a narrow `prepare(baseUrl)` operation to `PendingBrowserAccountReferenceRegistry`:

- acquire or reuse the existing entry keyed by normalized Base URL;
- start/reset the existing bounded retention timer immediately;
- return the reference only to Electron main;
- keep `run(baseUrl, loginOperation)` consuming the same entry on success and retaining it on failure.

Opening the site does not mark the account verified or persist it. It only ensures that the page and the later login probe share a partition.

## Renderer routing

`handleOpenBaseUrl()` maps current draft state:

- selected saved browser account -> `saved_session`;
- `new` + `browser_session` + selected existing slot -> `browser_slot`;
- `new` + `browser_session` + new identity -> `pending_browser_account`;
- auto, PAT, or other non-browser intent -> `default`.

The mapping reuses the same slot parsing already used by `handleBrowserBalanceSessionLogin()` and should be extracted into a small shared local helper to avoid drift.

When entering the new-session browser flow, initialize `draftBrowserSlotSelection` from the lowest numbered existing `BrowserIdentitySlot`. Fall back to `new` only when the slot list is empty. This is a renderer default only: an explicit user selection is never overwritten by later renders or unrelated state refreshes.

## Compatibility and rollback

No persisted schema changes. Existing opaque partitions retain their names and data. Rollback removes the structured open target and `prepare()` operation; pending entries created by the new version remain subject to TTL/shutdown cleanup.
