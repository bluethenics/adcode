# ADCode Extension Store

*Plan — 29 August 2026. A plan, not an implementation; no code was changed.*

Ship the editor first. Then move the heavy forty out of the installer and into a catalogue
you can add to any day of the week, without shipping a new build.

---

## The verdict — release now, the store is release two

Building all forty before launch would cost months, and every one of those weeks earns
nothing — ads only pay when the app is open on somebody's desk. The app already answers most
of the feature half of the top forty natively. What is genuinely missing is *languages*, and
that is one mechanism, not forty features.

1. **Release 1 — complete what exists.** Baseline merge, the toolchain installer, Emmet,
   snippets, finished Git, Markdown preview, more themes, signed installer and autoupdate.
2. **Release 2 — the store.** Registry API, admin tab, website page, in-app catalogue,
   capability resolver.
3. **Then a cadence.** One language pack or feature a week, arriving without an app update.

---

## First, the lag question

**Bundling forty things is not what makes a machine slow.** Disk is cheap and idle code costs
nothing. Three things actually cost the user: what runs at startup, how many language servers
are alive at once, and how big the download was before they ever opened a file.

So the catalogue is the right call — but for the download and the language servers, not
because "forty features" is inherently heavy. The rules that keep it fast are the same either
way:

| Rule | Why |
|---|---|
| **Nothing loads until it is needed** — activation events | A catalogue item registers a trigger (a file type opened, a command run, a panel revealed) and nothing of it is in memory before that. Core boot must not touch a single catalogue entry. |
| **Nothing downloads until it is asked for** — 30–250 MB each | A Java server, a C# server and a clangd build are each a substantial download. Twenty of them inside the installer is the real weight problem, and it is the one the store removes. |
| **One server per language, suspended when idle** — memory ceiling | Language servers are the only part of an editor that reliably eats a gigabyte. Cap the number alive, stop them after a period with no open file of that type, and lower the cap on low-memory machines. |
| **The user can see the cost** — a Running Extensions view | A settings view listing every active item with its memory and CPU and a stop button. People forgive an editor that is honest about what it is running. |

---

## The split — what stays in the app

Ten items stay in the app. Thirty move to the store.

### In the app

| Item | Demand | Why it stays |
|---|---:|---|
| Toolchain installer | core | The mechanism the whole store rests on — fetch, verify, unpack, register |
| Emmet | 6.1M | Small, universal, and every web developer notices it missing |
| Snippet engine | 39.6M | Tab stops and user snippet files. The packs themselves are catalogue items |
| EditorConfig and project-local tools | 15.0M | Touches the editing model itself; cannot be optional |
| Git graph, stash, rebase, conflicts | 84.7M | Finishing an existing subsystem, not adding one |
| Markdown and Mermaid preview | 24.5M | The preview pane already exists |
| TODO panel, bookmarks, project switcher | 20.3M | Kilobytes each, all over existing stores |
| Coding stats | 25.0M | Already computed in `shared/activity.ts`. A differentiator, so it ships to everyone |
| Account sync for settings, keys and themes | core | No payload at all — it is the account you already have |
| Keymap hint overlay | 1,440 cfg | One step from the existing shortcuts dialog |

### In the store

| Item | Demand | Note |
|---|---:|---|
| Python pack | 234.3M | Server, debug adapter, snippets, grammar |
| C / C++ pack | 103.2M | clangd plus CMake tooling |
| Java pack | 56.6M | jdtls, debugger, Maven and Gradle — the largest single payload |
| C# pack | 42.8M | Roslyn |
| Ruby pack | 41.4M ⁺ | Ruby LSP |
| PHP pack | 37.8M ⁺ | intelephense — already in the server list, becomes a catalogue payload |
| Go pack | 36.8M ⁺ | gopls and delve |
| Vue, Svelte, Astro | 10.0M ⁺ | Framework language servers |
| Rust pack | 6.3M ⁺ | rust-analyzer and a debug adapter |
| Dart and Flutter | 5.3M ⁺ | With device targets |
| Kotlin and Swift | 276k / 277k | Both top-thirty in Zed's catalogue |
| Tailwind CSS | 14.5M | Class completion and colour previews |
| YAML, XML, TOML | 44.2M | Config languages, one small pack |
| SQL, Prisma, GraphQL | 13.3M | Schema-aware editing |
| Terraform, Ansible, Dockerfile | 1.3M+ | Infrastructure languages |
| Notebooks | 108.5M | Large build, one clear audience — exactly what a catalogue is for |
| Docker and Compose | 52.4M | Run and attach from the ports panel |
| Dev Containers | 41.4M | Platform-specific and heavy |
| WSL workspaces | 40.4M | Windows only — a perfect catalogue item, and cheapest of the three remotes |
| Remote over SSH | 37.0M | Ships an agent to the far end |
| GitHub pull requests and Actions | 44.7M | Needs the OAuth you already have |
| Icon themes | 35.4M | Pure data, the ideal first catalogue entry to prove the pipe |
| Colour theme packs | 23.6M | Ship four in the app; the rest live in the store |
| Snippet packs | 39.6M | React, JavaScript, per-framework |
| CSV, PDF and hex viewers | 43.9M | Each one removes a reason to leave the editor |
| HTTP client | 15.0M | Executable `.http` files |
| Database explorer | 7.0M | Connections, queries, a results grid |
| Test explorer and coverage | 8.6M | Runs through the debug adapter already in core |
| Vim mode | 9.0M | Disqualifying for the people who want it, invisible to everyone else |

Figures are cumulative marketplace installs for the closest equivalent extension; **⁺** marks
an Open VSX figure, and the Kotlin, Swift and Zed-only rows are that catalogue's download
counts.

---

## So they never overlap

Overlap is not prevented by review; it is prevented by making it unrepresentable. Every
catalogue entry declares the **capability slots** it fills. Exclusive slots hold exactly one
active provider — the app picks, and the user can override. Additive slots merge, with
duplicates resolved by rank.

| Slot | Kind | How a clash resolves |
|---|---|---|
| `language:<id>` | Exclusive | User pin, then project config, then catalogue rank. Two Python servers can be installed; one is live. |
| `formatter:<id>` | Exclusive | The project's own binary wins, then the extension, then the built-in formatter. Already the rule in `packages/format`. |
| `debug:<id>` | Exclusive | One adapter per language, chosen by the run configuration. |
| `grammar:<id>` | Exclusive | Highest version wins; the loser is inert, not an error. |
| `theme.color` | Exclusive | One active theme. Installing never switches the current one. |
| `theme.icons` | Exclusive | Same, and the built-in set is always the fallback. |
| `keymap` | Exclusive | Default, Vim, or one other — never two at once. |
| `viewer:<type>` | Exclusive | Precedence order, plus an explicit "Open with" so the text editor is always reachable. |
| `snippets:<lang>` | Additive | Merged; an identical prefix is deduped by rank, never shown twice. |
| `command:<id>` | Unique | Namespaced by extension id and rejected at admin time if taken. |
| `panel:<id>` | Unique | Same, and one panel per entry keeps the workbench legible. |
| `keybinding` | Additive | Conflicts are detected at install time and shown to the user, never silently overridden. |

**Two rules that are specific to this codebase.** A catalogue entry may not add menu-bar rows:
`menuModel.test.ts` enforces unique mnemonics and unique labels per panel, and a downloadable
item cannot be allowed to break that invariant at runtime. Entries contribute commands to the
palette and at most one panel. And any entry that would duplicate something core already
provides must declare `replaces` explicitly, so the resolver can retire the built-in instead
of running both.

---

## How a new extension gets added

1. **Admin creates the entry.** Name, summary, icon, screenshots, category, capability slots,
   platform and architecture matrix, minimum app version, channel — stable or beta.
   → `apps/web/src/app/admin/_sections/Extensions.tsx`, as a tab inside an existing
   destination, matching the six-destination restructure

2. **The payload goes to object storage.** Never into a table. The advertiser logos that were
   stored as base64 in a row cost 1,960 ms of a 3,000 ms budget and killed serving twice
   over — extension payloads and screenshots go to R2 or Supabase Storage, and the row holds a
   URL, a size and a hash.
   → `services/api` — the `/assets` lesson applies verbatim

3. **The server validates before it accepts.** Rejects a duplicate command or panel id, warns
   on an exclusive slot already claimed in the same channel, requires a hash and a signature,
   and requires the platform matrix to be complete.
   → `services/api/src/contract.ts` — the manifest schema lives beside the ad contract

4. **Publish, with the controls you already built for ads.** Staged rollout by percentage, a
   per-entry kill switch, and unpublish that stops new installs without breaking existing
   ones. Read the current state on every poll, not just at start — the ad client learned that
   the hard way.

5. **The website page lists it within the minute.** `/extensions` on the marketing site,
   served from the same `/v1/extensions` the app reads, so the two can never disagree. Each
   entry has its own page for search traffic.
   → `apps/web` — part of marketing site work, roadmap item 5

6. **Install lands in the app.** The web page's Install button opens `adcode://install?id=…`
   through the protocol handler that already exists; inside the app the same catalogue is
   browsable directly. Download, verify hash and signature, unpack to
   `%APPDATA%/@adcode/desktop/extensions/<id>/<version>/`, register capabilities, activate on
   the next trigger. Uninstall removes the folder; old versions are collected.
   → `main/protocol.ts`, new `packages/catalog`

---

## The store, in iOS clothes

### The website page

- Large title, a search field, and a segmented control for Languages / Tools / Themes.
- A featured card at the top — one editorial pick, the way the App Store opens on Today.
- Grouped inset lists below: icon, name, one line, size, and a pill Install button on the
  right.
- Detail opens as a sheet: screenshots in a horizontal scroller, what it adds, what it
  replaces, size, version, changelog.
- System-native motion only — a spring on press, a fade on sheet open. Nothing announces
  itself.

### The view inside the app

- The same catalogue, same layout, so the two never feel like different products.
- Installed items show a Running badge with live memory, and a stop control.
- A "Recommended for this project" group at the top, driven by the languages actually in the
  open folder — the toolchain installer already knows them.
- Updates apply quietly in the background, with one line in What's New.

Keep one corner radius, one accent, one shadow depth across both surfaces. The iOS look breaks
the moment a page mixes three radii.

---

## Decide before Release 1, not after

| Decision | Status | Why now |
|---|---|---|
| **The manifest schema** (`contract.ts`) | Blocking | Even if the store lands in Release 2, the shape of an entry — id, version, slots, platform matrix, minimum app version, hash, signature — has to be frozen before the first build ships, or the first users are on a client that cannot read the catalogue. |
| **The activation model** (renderer boot) | Blocking | Which triggers exist, and the guarantee that core boot never touches a catalogue entry. Retrofitting lazy activation into a workbench that assumed eager loading is the expensive kind of rewrite. |
| **Where payloads live on disk** (`%APPDATA%`) | Blocking | Path layout, versioned folders, and the uninstall and garbage-collection rule. Cheap now, migration code later. |
| **First-party only, or submissions later?** | Assumed | This plan assumes a curated, first-party catalogue — it keeps the security pitch and avoids committing to a public extension API you would then have to support forever. If third-party submissions are the goal, the manifest needs a permission model from day one, and that is a different project. |
| **Free, or paid entries?** | Assumed | Assumed free, since ads fund the app. If any entry is ever paid, the entitlement check belongs in the same account the editor already signs into. |

---

## The counter-argument, fairly

Releasing early has a real cost: support arrives before the polish does, and a catalogue
contract written in a hurry is one you live with. Both are manageable — a beta channel absorbs
the first, and the three decisions above absorb the second.

What is not manageable is the other direction. Building thirty catalogue items before launch
means thirty features shaped by guesses about who is using the editor, with no telemetry, no
ad revenue and no feedback to correct them. Autoupdate is already wired. Ship, then let the
install counts you collect yourself decide the order of everything after Release 1.

---

## One blocker, unchanged

All of this touches `packages/`, which is absent on `feat/dashboards-and-ios-web`:
`git ls-files packages` returns nothing, so typecheck, the firewall and six test files fail,
and neither `npm run verify` nor the smoke run can pass. `feat/ai-workspaces` has all sixteen
packages restored and green, and the two branches touch disjoint file sets. That merge is step
zero of Release 1.

---

Install figures are the same live pull described in [ADCode Parity Map](./adcode-parity-map.md),
taken 29 August 2026 from the VS Code Marketplace, Open VSX, Zed and Package Control.
