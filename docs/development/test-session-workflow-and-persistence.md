# Test session workflow and persistence

This is the persistence PR. It introduces a versioned `TestSession` model
that captures operator-facing state safely, autosaves to `localStorage`
on every change, restores on app start, supports New / Export / Import
JSON, and never persists raw uploaded file content.

## What is persisted

| Field | Persisted |
|---|---|
| Source mode (`file` / `manual`) | yes |
| Source filename + parser summary | yes (filename, row count, warnings, errors — no raw text) |
| Selected channel (`p1` / `p2`) | yes |
| Selected period (timestamps + raw input text) | yes |
| `maxDropPct`, `targetPressure` | yes |
| Report metadata (customer / project / etc.) | yes |
| Manual rows (operator-typed) | yes |
| Session id + created timestamp | yes |
| Updated timestamp | yes (refreshed on every autosave) |
| Notes | yes (optional field) |

## What is NOT persisted

- **Raw uploaded file text.** A 50 MB log in localStorage is a footgun
  (storage quota, paste-back-into-the-app of stale data, GDPR concerns
  if it contains anything sensitive). Instead, file mode round-trips as a
  *summary* only: filename + parsed-row count. After restart the operator
  must reselect the file.
- **Computed analysis results.** `parseResult`, `baselineDrop`,
  `holdResult` are recomputed from manual rows / file content via the
  existing pipeline. Persisting them would just create another way for
  the dashboard to disagree with itself.
- **Chart state.** Zoom level, hover position, etc. are ephemeral.

## localStorage key

```
ihpu.testSession.v1
```

Versioned in the key itself, so a future v2 schema change can land
side-by-side without misreading v1 data.

## Data flow

```
            ┌─────────────────────────────────────┐
            │  AppState (operator-facing fields)  │
            └────────────────┬────────────────────┘
                             │
                             │ on every state change
                             ▼
                       commit(ctx)
                       ├── autosave(state)
                       │     └── buildTestSession() → JSON → localStorage
                       └── render(root, state)
```

```
            startup
              │
              ▼
   restoreSessionOnStartup(ctx)
              │
              ├── loadLastSession() → SessionParseResult
              │
              ├── deriveRestoredFields(session) → field slice
              │
              ├── apply fields to state
              │
              ├── applyActiveSource(ctx)            ← rebuilds parseResult from manualRows
              │                                       (or leaves null for file mode)
              ├── describeRestoreOutcome(session) → status message
              │
              └── render(root, state)
```

## Modules

| Module | Pure? | Owns |
|---|---|---|
| `src/session/sessionTypes.ts` | yes | `TestSession`, `SessionLoadResult`, `SessionRestoreOutcome`. Storage key constant. |
| `src/session/sessionModel.ts` | yes | `buildTestSession`, `deriveRestoredFields`, `describeRestoreOutcome`, `serializeTestSession`, `parseTestSessionJson`, `validateTestSession`. Hand-rolled JSON validation — no external schema lib. |
| `src/session/sessionStorage.ts` | mixed | localStorage adapter with probe + injectable backend for tests. Every public function is no-throw. |
| `src/app/state.ts` | yes | Adds `sessionStatus`, `sessionId`, `sessionCreatedAtIso` to `AppState`. |
| `src/app/events.ts` | DOM | `commit(ctx)` autosave wrapper, `restoreSessionOnStartup`, `handleNewTest`, `handleExportSession`, `handleImportSession`. |
| `src/app/render.ts` | DOM | New "Test-økt" card with status + dirty indicator + new/export/import controls. Sync helpers for restored input values. |

## Validation

`parseTestSessionJson(text)` returns a discriminated union:

- `{ ok: true; session }` on success
- `{ ok: false; error }` for `INVALID_JSON`, `NOT_AN_OBJECT`, `INVALID_VERSION`, `INVALID_SHAPE`, `CORRUPT_FIELD`

Tolerated absences:

- Missing `reportMetadata` → falls back to `createDefaultMetadata()` (empty strings)
- Missing `manualRows` or `notes` → empty / undefined defaults

Hard rejections:

- Wrong `version`
- Bad `sourceMode` (must be `file` or `manual`)
- Bad `selectedChannel` (must be `p1` or `p2`)
- `manualRows` not an array
- Missing required string fields (`sessionId`, `createdAtIso`, `updatedAtIso`)

A corrupt slot detected on startup is auto-cleared so the operator gets a
clean autosave next time. The app never crashes on bad localStorage data.

## UI

A new card "Test-økt" appears at the top of the app:

- **Ny test** — wipes every operator-facing field, clears the localStorage
  slot, resets channel to `p2`, `maxDropPct` to 5. Status shows "Ny test
  startet — alle felt er tilbakestilt."
- **Eksporter session** — generates a JSON download with a filename like
  `IHPU_session_20260508-013011_s_xxx.json`. Status shows "Session
  exported: <filename> (<bytes>)".
- **Importer session** — file input that accepts `.json`. On load,
  validates, applies, runs the analysis pipeline, autosaves silently
  (so the import message stays visible).
- **session-status** — current status / message
- **autosave-status** — "Sist lagret kl HH:MM:SS" or "Aldri lagret"
- **session-dirty-indicator** — short label: "Synkronisert", "Velg fil
  for å fortsette", "Ulagret", "Lagring feilet", etc.
- **session-source-summary** — current source mode + filename + row count

## Autosave semantics

Every state-mutating handler calls `commit(ctx)` which calls `autosave`
followed by `render`. autosave:

1. Builds a fresh `TestSession` from current state.
2. Reuses the previous `sessionId` + `createdAtIso` so an exported session
   stays correlated with its origin across edits.
3. Calls `saveLastSession(session)` (no-throw).
4. Updates `state.sessionStatus.kind = 'saved'` + `lastAutosaveAt`.
5. On `STORAGE_UNAVAILABLE` → status `unavailable` ("Autosave er
   deaktivert."). The app keeps working, just without persistence.
6. On other write failures → status `error` with the wrapped message.

A `silent: true` option lets handlers persist without overwriting their
own status message (used by `handleImportSession` after setting the
"Session importert" message).

## Dirty indicator

Because every state change autosaves synchronously, a true "unsaved
changes" state is impossible during normal use. The indicator instead
reflects:

- `Synkronisert` — last autosave succeeded
- `Velg fil for å fortsette` — file-mode session was restored but no raw file is loaded yet
- `Ny test — ingen data` — operator clicked Ny test
- `Autosave deaktivert` — localStorage probe failed
- `Lagring feilet` — write failed
- `Ulagret` — never saved (initial state, no localStorage)

## Restore flow on startup

`restoreSessionOnStartup(ctx)` runs once after `wireEvents`. Possible outcomes:

| `loadLastSession` result | UI effect |
|---|---|
| `NOT_FOUND` | sessionStatus.kind = 'idle', message "Ingen lagret økt funnet." |
| `STORAGE_UNAVAILABLE` | sessionStatus.kind = 'unavailable' |
| `INVALID` | sessionStatus.kind = 'error', slot wiped, message includes the validation reason |
| `OK` + manual session | restored_manual: rebuilds `parseResult` from `manualRows`, chart re-mounts |
| `OK` + file session with `sourceName` | restored_needs_file: settings restored, but `parseResult` stays null. Operator sees "Sist økt gjenopprettet — velg <filename> på nytt." |
| `OK` + empty session | restored_empty: settings restored only |

## Smoke coverage

Three Electron smoke tests now run:

1. **file flow** — original upload → period → metadata → CSV/PDF
2. **manual flow** — type 3 rows → use → analyse → CSV/PDF
3. **session flow** — type 3 rows → use + fill metadata + criteria →
   `window.reload()` → assert manual rows + metadata + criteria are
   restored, chart re-mounts. Then click `new-test` → assert everything
   cleared.

Each test starts with a `new-test-button` click to wipe any persisted
state from a previous test run (Electron shares its userData dir across
launches, so localStorage persists across `electron.launch()` calls).

## Unit test coverage

| File | Tests | Covers |
|---|---|---|
| `tests/sessionModel.test.ts` | 20 | build (manual + file), serialize/parse round-trip, validation error paths (malformed JSON, wrong version, bad sourceMode/channel, non-array manualRows, missing reportMetadata fallback), `deriveRestoredFields` independence (no aliasing), `describeRestoreOutcome` for all three kinds |
| `tests/sessionStorage.test.ts` | 10 | save/load/clear roundtrip, NOT_FOUND, INVALID for corrupt JSON, INVALID for wrong version, throw-from-backend handled gracefully, no-op backend reports NOT_FOUND |

Together with the existing parser/analysis/report/manual coverage, the
project now has 163 real tests, 0 skipped.

## Out of scope

- Cloud sync (no backend allowed in this PR)
- Multi-user or auth
- Session history / undo
- Auto-prompt to load an exported session at startup
- Browser-fingerprint-tied storage migration
- Persisting raw uploaded file content (deliberately excluded)

## Manual QA checklist before release

1. Open the app fresh — `Ny test` to clear any leftover state.
2. Upload `Dekk test Seal T.2`, fill metadata, set `maxDropPct=4`.
3. Confirm `autosave-status` updates with timestamps as you type.
4. Close the app entirely.
5. Reopen — confirm sessionStatus says "Sist økt gjenopprettet —
   velg «Dekk test Seal T.2» på nytt for å fortsette analysen."
6. Reupload the same file. Analysis comes back populated.
7. Click `Eksporter session` — confirm a `.json` file lands in
   Downloads. Open it in a text editor: it should NOT contain
   `314.386993` (no raw row data) or any base64 chunks.
8. Switch to manual mode, add 3 rows, click `Bruk manuelle rader`,
   confirm chart + analysis fire.
9. Close and reopen — confirm manual rows and analysis come back
   automatically (no "reselect file" prompt).
10. Click `Importer session`, pick the file from step 7. Confirm the
    file-mode settings are restored (channel, maxDropPct, metadata).
11. Click `Ny test`. Confirm every field is empty and a follow-up
    restart leaves it empty.

If any step fails, file a bug; do not release.
