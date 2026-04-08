# Vagtplan

Duty roster planning application built with Electron and Vue 3.

## Features

- Drag-and-drop medic assignments to day slots
- Week and month view modes
- Recurring assignments (weekly, biweekly, triweekly, monthly + random day variants)
- Standby pool with comments for paused medics
- Auto-fill with fair distribution
- Export as PNG image or CSV
- Import from CSV
- Conflict detection (consecutive day warnings)
- Per-day notes
- Undo support (Ctrl+Z)
- Auto-update via GitHub Releases
- Danish language UI

## Setup

```bash
npm install
npm start
```

## Build installer

```bash
npm run build
```

The installer will be in `dist/Vagtplan Setup X.X.X.exe`.

## Publish update

1. Set your GitHub username as `owner` in the `publish` section of `package.json`
2. Bump the `version` in `package.json`
3. Run:

```bash
GH_TOKEN=your_github_token npm run publish
```

This creates a GitHub Release with the installer attached. Installed copies auto-update on next launch.

## Tech stack

- **Electron** - Desktop shell
- **Vue 3** - UI framework (CDN build, no bundler)
- **electron-updater** - Auto-update via GitHub Releases
- **electron-builder** - Packaging and installer creation
