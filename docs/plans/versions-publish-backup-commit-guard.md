# Versions: keep published versions on delete, block no-change commits, stop the screen freeze

## Context
Three related problems in the Docs editor's version flow:

1. **Deleting a document wipes its published versions.** `DELETE /api/docs/:id` removes every version in the subtree. You want published versions kept in the DB as a backup. Today nothing marks a version as published: Commit and Publish both call the same `saveVersion()` and create identical `versions` rows.
2. **A commit with no changes isn't blocked or reported.** [EditorPage.tsx:273](frontend/src/pages/EditorPage.tsx#L273) silently returns "success" when the content matches `lastSavedVersionHtmlRef`. That ref is set on load to the *document* content, not the latest *version* ([EditorPage.tsx:173](frontend/src/pages/EditorPage.tsx#L173)). So after reopening a doc with autosaved but uncommitted edits, Commit wrongly does nothing. Publish still shows "published successfully" when nothing was saved, and the backend accepts duplicate versions from anyone (other tabs, Swagger).
3. **The screen freezes.** Every `apiFetch` call increments a global counter ([api.ts:324](frontend/src/services/api.ts#L324)). While it's above 0, [App.tsx:51](frontend/src/App.tsx#L51) shows `AppLoadingScreen`, a `fixed inset-0 z-100` "Loading data" overlay that blocks the page. A commit runs `PUT /api/docs/:id`, then `POST /versions`, then `GET /api/docs`, all against Azure Postgres, so the overlay covers the editor for the whole chain. Autosave triggers the same overlay while you're typing. Publish also ends in a blocking `window.alert`.

Live DB facts: `versions` has no FK to `documents`, so rows can outlive their doc. The table has no `isPublished` column; `userId` and `tenantId` are null on all 14 rows; the migrations folder is empty, so schema changes are applied as manual SQL.

## Behaviour after the change
- **Commit** with content identical to the latest version: no request is sent. An info notice appears: "No changes since the last commit." The popup's Commit button is disabled with that hint.
- **Publish** when the content matches the latest version:
  - If that version isn't published yet, it's marked as published. No duplicate row is created.
  - If it's already published, the request is blocked with "Already published — no changes since."
- **Publish** with changes creates a new published version.
- While a Commit or Publish is in flight, both buttons are disabled and show a spinner ("Committing…" / "Publishing…"). There's no full-screen overlay and no `alert`; success shows as an info notice ("Committed." / "Published.").
- **Deleting a doc** removes comments and unpublished versions. Published versions stay as backups.
- **The 20-version cap** prunes only unpublished versions.
- **Only content counts as a change.** Title-only edits are autosaved and don't make a new version, because versions snapshot content only.

## Changes

### 1. DB and schema
In [schema.prisma](backend/prisma/schema.prisma), add to `model Version`:
- `isPublished Boolean @default(false)`
- `docTitle String?`: the doc title captured at publish time, so an orphaned backup is identifiable.

Apply to `docsync_dev`, then run `prisma generate`:
```sql
ALTER TABLE versions
  ADD COLUMN IF NOT EXISTS "isPublished" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "docTitle" text;
```
Existing rows become unpublished; nothing can tell them apart. Also update the comment on `Document.parent` that says deletes remove all versions.

### 2. Backend: `POST /api/docs/:docId/versions` ([versions.routes.js:125](backend/src/routes/versions.routes.js#L125))
- Accept an optional body flag `published` (boolean).
- Load the latest version for the doc (`findFirst`, `orderBy savedAt desc`). It counts as unchanged when `latest.content.trim() === content.trim()`.
  - Unchanged, not publishing: return **409** `{ error: 'No changes since the last version.', code: 'NO_CHANGES' }`.
  - Unchanged, publishing, and `latest.isPublished`: return **409** `{ error: 'Already published — no changes since.', code: 'NO_CHANGES' }`.
  - Unchanged, publishing, not yet published: update the latest version with `isPublished: true` and `docTitle: doc.title`. Return **200** `{ version, promoted: true }`.
  - Otherwise create the version with `isPublished`, `docTitle` (when published), and also `userId: req.user.id` and `tenantId: req.tenant.id`, which are missing today. Return 201.
- Overflow pruning: add `isPublished: false` to the where-clause, so published versions are never auto-deleted and don't count toward the 20.
- Include `isPublished` in the version objects returned by POST, `GET /` and `GET /all`, and in the editor bootstrap.

### 3. Backend: `DELETE /api/docs/:id` ([docs.routes.js:597](backend/src/routes/docs.routes.js#L597))
- Change the version delete to `tx.version.deleteMany({ where: { docId: { in: ids }, isPublished: false } })`.
- Count the published rows that remain inside the transaction, return `{ message, deletedCount, preservedVersionCount }`, and add `preservedVersionCount` to the audit log.
- Update the JSDoc.

### 4. Backend: editor bootstrap ([editor.routes.js:84](backend/src/routes/editor.routes.js#L84))
`versionRows` is already loaded with content. Add `latestVersion: { content, isPublished } | null`, taken from `retainedVersions[0]`, so the client's no-change check compares against the real latest version.

### 5. Frontend: `api.ts`
- Add `export class ApiError extends Error { status; code? }` and throw it from `apiFetch`/`apiFetchText` instead of a plain `Error`. Existing `catch` code keeps working because it's still an `Error`.
- Add a `background?: boolean` option to `FetchOptions`. When true, skip `beginApiRequest`/`endApiRequest`, so the global overlay isn't shown.
- `versionsApi.save(token, docId, content, preview?, opts?: { published?: boolean })` passes `published` and `background: true`, and returns `{ version, promoted? }`.
- `docsApi.update` accepts an options argument to pass `background: true` through.
- Add `isPublished` to the version types, and `latestVersion` to the bootstrap type.

### 6. Frontend: [EditorPage.tsx](frontend/src/pages/EditorPage.tsx)
- **Baseline:**
  - On bootstrap, set `lastSavedVersionHtmlRef` from `latestVersion?.content` (`null` when there are no versions) and add `latestVersionPublishedRef`.
  - After a successful save, update both refs.
  - On restore, stop overwriting the baseline with the restored content, so committing a rollback is allowed.
- **Derived state:** `hasUncommittedChanges = normalizeVersionHtml(currentHtml) !== lastSavedVersionHtmlRef.current`.
- **In-flight state:** `versionAction: null | 'commit' | 'publish'`, plus a ref guard against double clicks and Ctrl+S repeats.
- **`handleSaveDocument` (Commit and Ctrl+S):** if there are no changes, show the info notice and return before any request. Otherwise set `versionAction`, save the doc, save the version, and show "Committed."
- **`handlePublishDocument`:** if there are no changes and the latest version is already published, show the notice and return. Otherwise save with `{ published: true }`, show "Published." (or "Marked the latest version as published." when the response has `promoted`), and remove `window.alert`.
- **`saveVersion`:** drop the silent "unchanged → true" early return; the handlers decide now. Treat `ApiError` with `code === 'NO_CHANGES'` as an info notice, not an error. This covers changes committed from another tab.
- **`saveDocumentNow`:** skip the `PUT` when content and title equal the `lastAutoSaved*` refs, since autosave already stored them. This removes one round trip per commit. Use `background: true`.
- **Autosave** (`docsApi.update` around line 226) and the best-effort docs list refresh (around line 823): use `background: true`. The header cloud icon already shows saving progress.
- **Notice UI:** add a `saveNotice` state rendered next to the existing `saveError` banner (around line 1127), in the same style but cyan, with `role="status"`. It auto-dismisses after about 4s.
- **Buttons:**
  - Commit and Publish get `disabled={versionAction !== null}`, a spinner icon and an "ing" label while running.
  - The popup's Commit button is disabled with the hint "No changes since the last commit" when `!hasUncommittedChanges`.
  - The textarea is disabled while committing.
- **Version panel:** show a small "Published" badge for versions with `isPublished`, wherever [SavedDocuments](frontend/src/pages/EditorPage.tsx#L1182) renders version rows.

### 7. Swagger ([openapi.js](backend/src/openapi.js))
- `versionSchema`: add `published: { type: 'boolean' }`.
- `POST /api/docs/{docId}/versions`:
  - Add a description of the no-change rule and the publish promotion.
  - Add a 409 response example `{ error, code: 'NO_CHANGES' }`.
  - Add `isPublished` to the response example.
- Add `isPublished` to the GET list examples.
- `DELETE /api/docs/{id}`: change the description to say published versions are kept as backups, and add `preservedVersionCount` to the example.

### 8. Tests
- [docs.test.js:450](backend/test/docs.test.js#L450): give fixture versions an explicit `isPublished` (the mock `matches()` compares against null). Add a published version in the subtree and assert it survives with `preservedVersionCount: 1`.
- New `backend/test/versions.test.js`, using the same prisma mock pattern as `docs.test.js`. Cover:
  - a commit with new content returns 201;
  - identical content returns 409 `NO_CHANGES`;
  - publishing unchanged unpublished content returns 200 with `promoted`;
  - publishing unchanged published content returns 409;
  - pruning beyond 20 never deletes a published version;
  - new rows get `userId` and `tenantId`.

## Verification
1. Run `npm test` in `backend/`.
2. Apply the SQL, then confirm both columns exist via `information_schema.columns`.
3. Use the app on localhost:5173 with DevTools open (the servers are already running):
   - Open a doc and click Commit without editing. The notice appears, no network request is sent, and there's no overlay.
   - Edit, then Commit. The spinner shows on the button with no full-screen overlay. The version appears in the panel.
   - Publish right after that commit, with no edits. The response has `promoted: true`, and the Published badge appears on the same row with no duplicate.
   - Publish again. The "Already published" notice appears.
   - Type for a while. The "Loading data" overlay no longer flashes during autosave.
   - Reopen a doc that has autosaved but uncommitted edits, then Commit. This must create a version; it's the baseline bug fix.
4. In Swagger, `POST` an identical version twice and expect a 409 the second time. Delete a doc that has one published and one committed version: the response has `preservedVersionCount: 1`, and a DB query shows only the published row left, with `isPublished=true` and `docTitle` set.
