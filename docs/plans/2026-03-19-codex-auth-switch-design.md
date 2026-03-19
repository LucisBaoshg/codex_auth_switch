# Codex Auth Switch Design

## Summary

This project is a small desktop utility for managing multiple Codex account profiles. Each profile is a pair of files:

- `auth.json`
- `config.toml`

The app supports:

- importing a profile from an existing pair of files
- creating and storing multiple named profiles
- listing stored profiles
- showing which profile is currently active
- switching the active profile in one click
- configuring the target Codex directory when default detection is wrong

## Framework Choice

### Option A: Tauri + Rust + Vite + TypeScript

Pros:

- small bundle and runtime footprint
- excellent filesystem access through Rust
- good macOS and Windows packaging story
- strong performance for simple utilities

Cons:

- requires Rust toolchain

### Option B: Electron + Vite + TypeScript

Pros:

- faster initial setup for JavaScript-only development
- large ecosystem

Cons:

- much larger binary size
- higher memory usage for a small utility

### Option C: Flutter Desktop

Pros:

- strong cross-platform UI toolkit

Cons:

- heavier toolchain
- more UI work for a utility-first desktop app

### Decision

Choose Option A. The user explicitly wants a small and high-performance framework, which fits Tauri best.

## Core UX

### Main Screen

The main window is a compact control center with three areas:

1. Target location and status
2. Stored profile list
3. Actions and recent switch result

### Primary Actions

- `Import Profile`: pick `auth.json` and `config.toml`, then save as a named profile
- `Switch`: overwrite active Codex files with the selected profile after backup
- `Refresh`: rescan current target files and compare with stored profiles
- `Open Codex Folder`: open the target directory in the OS file manager

### Safety Behaviors

- Before every switch, back up current `auth.json` and `config.toml` into an app-managed backup folder
- Validate imported JSON and TOML before saving
- Refuse incomplete profiles
- Show explicit error messages when target files cannot be written

## Path Strategy

The app should not hardcode a single path. It should auto-detect a default and also allow manual override.

### Default Target Directory

- macOS: `~/.codex`
- Linux: `~/.codex`
- Windows: `%USERPROFILE%\\.codex`

### Why Manual Override Exists

The Windows path is not confirmed from local docs in this workspace, and some users may redirect Codex config to custom locations. A text field plus a folder picker keeps the app robust.

## Local App Data Model

The utility stores its own data under the application data directory returned by Tauri.

### Proposed Layout

```text
app_data/
  profiles/
    {profile-id}/
      meta.json
      auth.json
      config.toml
  backups/
    20260319-111500/
      auth.json
      config.toml
  state.json
```

### `meta.json`

```json
{
  "id": "sample-id",
  "name": "Work Account",
  "createdAt": "2026-03-19T11:15:00Z",
  "updatedAt": "2026-03-19T11:15:00Z",
  "notes": ""
}
```

### `state.json`

Stores:

- custom target directory
- last selected profile id
- last successful switch metadata

## Backend Responsibilities

Rust backend commands should handle:

- resolving default Codex target path
- loading app state
- listing profiles
- importing a profile
- deleting a profile
- switching active profile
- checking which profile matches the current target files
- opening folders

Business logic should live in plain Rust modules so it can be tested without the UI.

## Matching Current Active Profile

When refreshing, the app reads the target `auth.json` and `config.toml` and computes hashes. If those match a stored profile pair, the UI marks that profile as active. If none match, the UI shows `custom / unknown`.

## Testing Strategy

Follow TDD for the backend:

- import rejects invalid JSON
- import rejects invalid TOML
- valid import persists files and metadata
- switch creates backup before overwrite
- switch writes both files
- active-profile matching works by file content hash
- default path resolution works per platform conventions

UI testing can stay lighter:

- type-check frontend
- ensure command payloads and display mapping compile

## Initial Scope Limits

To keep the first version sharp and reliable, exclude:

- encryption at rest
- cloud sync
- profile export package format
- editing file contents inside the app
- automatic Codex process restart

These can be added later if needed.
