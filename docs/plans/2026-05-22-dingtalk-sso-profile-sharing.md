# DingTalk SSO Profile Sharing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add enterprise profile sharing protected by DingTalk SSO and allow desktop clients to access only profiles shared with the current employee.

**Architecture:** The Next.js website becomes the sharing backend. Users log in through SSO Center, the backend stores a signed session cookie, profile records include owner and shared recipient metadata, and desktop clients authenticate with generated bearer tokens.

**Tech Stack:** Next.js route handlers, filesystem JSON storage, HttpOnly cookies, Node crypto, Tauri/Vite frontend settings, Vitest, Rust remote sync tests.

---

### Task 1: Backend Auth And Permission Tests

**Files:**
- Create: `website/src/lib/auth.ts`
- Create: `website/src/lib/profile-store.ts`
- Create: `website/tests/profile-store.test.ts`
- Modify: `website/package.json`

**Steps:**
1. Write tests for visible profile filtering by owner and `sharedWith`.
2. Write tests for bearer token hashing and lookup.
3. Run `npm test -- --runInBand` from `website` and verify the tests fail because helpers do not exist.
4. Implement minimal store/auth helpers.
5. Re-run tests and verify green.

### Task 2: SSO Routes And Protected Profile APIs

**Files:**
- Create: `website/src/app/api/auth/me/route.ts`
- Create: `website/src/app/api/auth/login/route.ts`
- Create: `website/src/app/api/auth/callback/route.ts`
- Create: `website/src/app/api/auth/logout/route.ts`
- Create: `website/src/app/api/auth/desktop-token/route.ts`
- Modify: `website/src/app/api/profiles/route.ts`
- Modify: `website/src/app/api/profiles/[id]/route.ts`
- Modify: `website/src/app/api/profiles/[id]/[filename]/route.ts`

**Steps:**
1. Add route tests where practical through helper tests and TypeScript build.
2. Require either session cookie or bearer token for profile reads.
3. Require session cookie for create/update operations.
4. Filter list/detail/files by permission.
5. Return `401` for unauthenticated access and `404` for profiles outside the user's visibility.

### Task 3: Website UI

**Files:**
- Modify: `website/src/app/profiles/page.tsx`
- Modify: `website/src/app/profiles/[id]/page.tsx`
- Modify: `website/src/app/page.tsx`

**Steps:**
1. Add login/logout/current-user handling.
2. Add desktop token generation UI.
3. Add `sharedWith` textarea to upload/edit forms.
4. Send `sharedWith` to profile APIs.
5. Hide upload/edit controls when not logged in.

### Task 4: Desktop Remote Settings

**Files:**
- Modify: `src/main.ts`
- Modify: `src/styles.css`
- Test: `tests/sidebar-layout.test.ts` or new Vitest test.

**Steps:**
1. Write a failing test that saving remote URL/token causes network fetches to include `Authorization: Bearer`.
2. Add localStorage-backed remote sharing settings.
3. Add settings UI for remote shared library URL and desktop token.
4. Use the configured URL and bearer token in all network profile fetches.
5. Display `401` with a clear login/token message.

### Task 5: Verification

**Commands:**
- `npm test`
- `npm run build`
- `cd website && npm test`
- `cd website && npm run build`
- `cd src-tauri && cargo test remote_sync`
