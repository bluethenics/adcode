---
slug: shared-github-projects
title: Share a GitHub project live
description: Invite teammates to edit a GitHub project live and use their own AI models against the host's current files.
section: The workbench
published: 2026-10-30
updated: 2026-10-30
order: 12
related: workbench-collab, team-agents-and-the-live-room
---

# Share a GitHub project live

Open a local project with a GitHub remote. Choose the live-session button on the sidebar, choose Share, and send the invite to a teammate. The host must keep ADCode open. Sessions use an encrypted internet relay and expire after 24 hours. End session closes the invite and disconnects everyone.

## Access and editing

New internet guests join as viewers. In People, the host can grant edit access or return someone to view-only. Guests see live cursors and edits. The invite grants access to project files, so share it with the people you want in the project.

Before joining, guests open their own checkout of the same GitHub repository. They use that project tree to open shared files. They can also ask their own AI to read and search the host's project. File tools run on the host, so the results reflect current shared files. Editors can ask their AI to propose or make edits; viewers can only read. Remote file edits are serialized and exact-text edits check current file content. Host-side edits refresh live documents.

Guest commands, external tools, private memory and shell access are unavailable in this release. Ask the host to run checks. Each guest uses their own model connection and allowance. A disconnected guest agent stops accessing the project and never falls back to changing its local files.

## GitHub and saving

The host's working folder is authoritative for the session. GitHub remains the saved project history. The host reviews commit requests, checks changes, and pushes with their existing GitHub credentials. Invites never include GitHub credentials. Changes are not automatically pushed.

The relay retains session credentials and expiry, and does not persist source files or log message bodies. See [Privacy](/privacy).
