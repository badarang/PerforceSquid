# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PerforceSquid is a GitKraken-style desktop client for Perforce version control, built with Electron, React, and TypeScript.

## Commands

```bash
# Development - runs Vite dev server with Electron hot reload
npm run dev

# Type checking
npm run typecheck

# Build for production
npm run build           # Current platform
npm run build:win       # Windows (NSIS installer + portable)
npm run build:mac       # macOS (DMG)
npm run build:linux     # Linux (AppImage + deb)
```

## Architecture

### Electron Main Process (`electron/`)
- `main.ts` - Window creation and IPC handler registration
- `preload.ts` - Context bridge exposing `window.p4` and `window.settings` APIs to renderer
- `p4/p4Service.ts` - Core Perforce CLI wrapper, executes p4 commands via child_process
- `p4/types.ts` - TypeScript interfaces for P4 data structures

### React Renderer (`src/`)
- `App.tsx` - Root component with 3-panel layout and toast context
- `stores/p4Store.ts` - Zustand store for global P4 state (info, files, changelists, diffs)
- `components/` - UI components (Sidebar, FileList, DiffViewer, CommitGraph, etc.)

### IPC Communication Pattern
1. Renderer calls `window.p4.someMethod()` (defined in preload.ts)
2. Preload invokes IPC channel `p4:someMethod`
3. Main process handler in main.ts calls `p4Service.someMethod()`
4. p4Service executes `p4` CLI command and parses output

### Key Dependencies
- **reactflow** - Stream graph visualization
- **react-diff-view** - Unified diff rendering
- **zustand** - State management
- **elkjs** - Graph layout algorithms

### Tailwind Theme
Custom colors defined in `tailwind.config.js`: `p4-dark`, `p4-darker`, `p4-border`, `p4-blue`, `p4-green`, `p4-red`, `p4-yellow`

## Prerequisites

- Perforce CLI (`p4`) must be installed and in PATH
- P4 environment variables should be set (P4PORT, P4USER, or login via `p4 login`)
