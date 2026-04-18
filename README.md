# iStickMD

A personal homelab web app served from a Raspberry Pi 5. Left-rail app shell with
a OneNote-style notes app — expandable notebooks in the sidebar, sticky-note
cards in the main area, markdown files on disk.

Built in collaboration with [Claude Code](https://claude.com/claude-code).

## Why

I liked the sticky-note app Claude Code built me at work. My brain organizes
things spatially and visually, and I wanted the same style at home — but also
as a surface an AI can read and write to. Each note is a plain `.md` file with
YAML frontmatter, so anything that can open a folder of markdown (a shell, a
text editor, another AI) can work with the same data.

## Features

- **Profile picker** — multiple users on one instance, no passwords (LAN-only
  for now). Data is separated per user on disk.
- **Notebooks** — expandable folders in the sidebar. Click the caret to expand
  and see notes inline; click the name to select and view the cards.
- **Sticky-note cards** — each note is a colored card with a 5-line preview.
  Drag-to-reorder, resize vertically, 7 colors.
- **Markdown editor** — toggle raw ↔ rendered, auto-save, per-note color.
- **File-backed** — notes are just `.md` files. Browse, grep, git, or pipe them
  to whatever you want.

## Stack

| Layer     | Tool                          | Why                                              |
|-----------|-------------------------------|--------------------------------------------------|
| Runtime   | [Bun](https://bun.sh) 1.3+    | Runtime + bundler + package manager in one binary; fast on aarch64 |
| Server    | [Hono](https://hono.dev)      | Tiny, fast, clean nested routing                 |
| Frontend  | React 19 + Vite               | Mature ecosystem for dnd and markdown            |
| Drag/drop | [@dnd-kit](https://dndkit.com)| Accessible, keyboard-friendly                    |
| Markdown  | react-markdown + remark-gfm   | GitHub-flavored tables, task lists, strikethrough|
| Frontmatter | gray-matter                 | YAML in the head of each `.md` file              |
| Runtime management | systemd              | One unit, auto-restart, starts on boot           |
| Deploy    | rsync over SSH                | Build on laptop, push to Pi. No Docker, no CI    |

## Data layout

```
<DATA_DIR>/
├── users.json                    # user registry
└── <user>/
    ├── notebooks.json            # notebook order + metadata
    └── <notebook-slug>/          # notebook = folder
        └── <note-slug>.md        # note = markdown file
```

Each note file looks like:

```markdown
---
title: Router
color: blue
order: 0
height: 200
updated: '2026-04-17T21:52:15.807Z'
---
# Router

UDM Pro, firmware 4.x
```

## Dev

```bash
bun install
bun run dev      # starts Vite (5173) + API (3000) together
```

Open http://localhost:5173. The Vite dev server proxies `/api/*` to the Bun
server on 3000.

## Deploy

Targets a Raspberry Pi at `dork@192.168.8.119` by default. Override with a
positional arg.

```bash
./scripts/deploy.sh                # deploy to default host
./scripts/deploy.sh dork@otherpi    # deploy elsewhere
```

The script builds on your laptop, rsyncs to `/home/dork/istickmd`, runs
`bun install --production` remotely, and installs/enables
`/etc/systemd/system/istickmd.service`. The service listens on port 3000 and
stores data in `/home/dork/istickmd-data`.

## Status

Built and working:

- Shell + profile picker + user switcher
- Notes app (notebooks, cards, drag-reorder, resize, color, markdown editor)

Placeholders in the shell (not yet implemented):

- Claude Code console (xterm.js + node-pty)
- Custom agents (Claude Agent SDK)

## Data privacy

The `data/` directory is gitignored and never uploaded. Your notes stay on your
machine.
