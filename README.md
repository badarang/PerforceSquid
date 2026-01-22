# PerforceSquid

<div align="center">

**GitKraken-style desktop client for Perforce**

[![Electron](https://img.shields.io/badge/Electron-28.0-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.2-61DAFB?logo=react&logoColor=white)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)

</div>

---

## Features

| Feature | Description |
|---------|-------------|
| **Workspace Management** | View and switch between Perforce clients |
| **Change Tracking** | See all pending changelists at a glance |
| **Diff Viewer** | Side-by-side diff view for changed files |
| **Submit & Sync** | Easy submit and sync operations |
| **Shelving** | Shelve and unshelve changes |
| **History** | Browse submitted changelist history |
| **Blame/Annotate** | See who changed each line |

---

## Screenshots

> *Coming soon*

---

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [Perforce Command-Line Client (p4)](https://www.perforce.com/downloads/helix-command-line-client-p4)
- Perforce server connection configured

### Development Setup

```bash
# Clone the repository
git clone https://github.com/your-username/perforcesquid.git
cd perforcesquid

# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Build for Distribution

```bash
# Windows
npm run build:win

# macOS
npm run build:mac

# Linux
npm run build:linux
```

Build outputs will be in the `release/` folder.

---

## Project Structure

```
perforcesquid/
├── electron/           # Electron main process
│   ├── main.ts         # Main entry point
│   ├── preload.ts      # Preload script
│   └── p4/             # Perforce service
│       ├── p4Service.ts
│       └── types.ts
├── src/                # React frontend
│   └── ...
├── build/              # Build resources
│   └── icon.png        # App icon (256x256)
└── package.json
```

---

## Tech Stack

```
┌─────────────────────────────────────────────────┐
│                   PerforceSquid                 │
├─────────────────────────────────────────────────┤
│  Frontend        │  Electron Main Process       │
│  ─────────────   │  ────────────────────────    │
│  React 18        │  Node.js                     │
│  TypeScript      │  p4 CLI wrapper              │
│  Tailwind CSS    │  IPC handlers                │
│  Zustand         │                              │
├─────────────────────────────────────────────────┤
│                 Perforce Server                 │
└─────────────────────────────────────────────────┘
```

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build for production |
| `npm run build:win` | Build Windows installer (NSIS + Portable) |
| `npm run build:mac` | Build macOS DMG |
| `npm run build:linux` | Build Linux AppImage & DEB |
| `npm run typecheck` | Run TypeScript type checking |

---

## Configuration

The app uses your existing Perforce environment variables:

| Variable | Description |
|----------|-------------|
| `P4PORT` | Perforce server address |
| `P4USER` | Perforce username |
| `P4CLIENT` | Default workspace/client |

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License.

---

<div align="center">

**PerforceSquid** - Making Perforce a little more friendly

</div>
