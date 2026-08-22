# What protects ADCode's code, and what doesn't

You asked to make sure users cannot steal ADCode's code. This is the honest answer:
**the part of that goal that is achievable, what actually achieves it, and the part that
is not achievable at all.**

## The part that is not achievable

**A user running ADCode has ADCode's JavaScript on their machine, and can read it.**

Electron ships an application as JavaScript inside an `asar` archive. `asar` is an archive
format — a `tar` with an index. It is not encryption, has no key, and reverses with one
command:

```
npx asar extract app.asar out/
```

There is no configuration that changes this. Options people reach for and what they
actually buy:

| Approach | What it really does |
|---|---|
| `asar` packaging | Bundles files into one archive. Reverses in seconds. Already on. |
| Minification | Removes names and whitespace. Slows a reader down; hides nothing. |
| `bytenode` / V8 snapshots | Ships compiled bytecode instead of source. Decompilers exist, it breaks on Electron upgrades, and it makes crash reports unreadable for you too. |
| Native addon for "secrets" | Moves a string into a `.node` file. `strings` finds it. |

Anyone who wants the renderer code badly enough will get it. Any claim otherwise —
including from a vendor selling protection — is false.

## What actually protects the valuable part

**The logic worth stealing is not in the client.** This is the real answer, and it is
already how the system is built:

- **Ad targeting and ranking** run in `services/api`, not the editor.
- **What an impression is worth** is computed server-side. `packages/ads` displays money;
  it never calculates it (`docs/specs/2026-08-16-ad-core-design.md` §1).
- **Receipt verification** is server-side. A client that forges receipts earns nothing,
  because payment requires a matching serve record the server itself issued.
- **Campaign budgets, advertiser balances, and the ledger** exist only on the server.
- **No signing key ships in the binary.** §1 of the brief is explicit that a key shipped
  with the app can be extracted by anyone, so client-side signing would be theatre.

Someone who extracts the entire renderer gets a UI. They do not get the ad network, the
advertiser relationships, the ledger, or the ability to mint money.

## What is now in place beyond that

**Electron fuses** — flags flipped in the binary itself, which cannot be turned back on by
an environment variable or a command-line argument. Configured in `electron-builder.yml`:

| Fuse | Closes |
|---|---|
| `runAsNode: false` | `ELECTRON_RUN_AS_NODE=1 adcode.exe evil.js` — using the shipped binary to run arbitrary Node |
| `enableNodeOptionsEnvironmentVariable: false` | `NODE_OPTIONS=--require=evil.js` injection |
| `enableNodeCliInspectArguments: false` | `--inspect`, attaching a debugger to read process memory |
| `onlyLoadAppFromAsar: true` | Swapping the asar for an unpacked directory of modified code |
| `enableCookieEncryption: true` | Reading the cookie store off disk |

These do not hide the code. They stop a shipped ADCode being repurposed as a general
way to run code with ADCode's identity — which is a different and more useful goal.

**No source maps ship.** Vite's production build emits none, so the bundle carries no
path back to readable original sources.

## What is deliberately not done

**Code signing.** Builds are unsigned. Windows shows a SmartScreen warning; macOS calls
the app unidentified. Both download pages say so plainly. Signing does not protect the
code — it proves the binary came from you and has not been tampered with, which is worth
having, and needs an OV/EV certificate (~$200–600/yr) plus an Apple Developer account for
notarisation.

**Obfuscation.** Deliberately skipped. It costs debuggability and crash-report legibility
permanently, in exchange for delaying a determined reader by an afternoon.

## If someone ships a fork

The protection there is legal and operational, not technical:

- `LICENSE` is `UNLICENSED` in `package.json` — no rights are granted.
- A fork cannot reach your ad server: serving requires a Firebase project you control, and
  the API verifies tokens against it.
- A fork therefore has no ads, no earnings, and no ledger. It is a free editor with your
  UI, which is a trademark problem rather than a revenue one.
