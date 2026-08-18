# Live collaboration, and the floating preview

*17 August 2026.*

Two features, brainstormed together because they shipped together, designed apart because only
one of them is architectural.

The brief asked for four things: a preview that can float free of its column and also open in a
real browser; live editing of the same folder by several people at once, with visible cursors;
an earnings report as a pop-up with its own activity-bar icon; and a fix for icons sitting
off-centre in their buttons. This document covers the first two. The earnings report and the
icon fix are recorded at the end, because the icon fix turned out to have a root cause worth
writing down.

---

## 1. The floating preview

### What was already there

`previewPane.ts` drew a column beside the editor whose width came from a `--preview-width`
custom property, and its toolbar already had an **Open in browser** button wired to
`preview.openExternal()`. So half of the request existed; the new part was the floating host.

### The constraint that decided the design

**Reparenting an `<iframe>` destroys its document and reloads it.** The obvious implementation -
append the frame into whichever container is wanted - would reload the user's page on every
dock and undock, discarding scroll position, form state, and any JavaScript state the page was
holding. For a surface whose entire purpose is showing the effect of the last edit, throwing the
page away on a layout change is a bad trade.

So **the iframe never moves.** One `.preview-pane` element stays where it is in the DOM and only
its positioning changes, switched by a `data-placement` attribute:

| Placement | Positioning | `--preview-width` |
|---|---|---|
| `docked` | in the layout grid, as before | `42%` |
| `floating` | `position: fixed` with a translate | `0px`, so the editor reclaims the space |

Undocking is a class change rather than a re-mount, so the previewed page keeps running.
`npm run smoke` asserts exactly this by comparing the iframe's **node identity** and its `src`
across the move - the only way a reload is visible from outside.

Drag and resize copy the chat widget's proven pattern: pointer capture on the header, `transform`
only (never `left`/`top`, per §1's animate-only-transform-and-opacity rule), and a resize grip
with minimum dimensions.

### `floatingLayout.ts`

The one piece of real logic, extracted as pure functions because that is the only way it gets
tested: **clamping a remembered position back into the viewport.**

A saved position is a pair of numbers from a previous session, and nothing guarantees the window
is still the size it was - a monitor gets unplugged, the window is restored from maximised, the
display scale changes. Replaying those coordinates unchecked puts the card partly or wholly
outside the viewport, and because a card is dragged by its own header, **a card whose header is
off-screen cannot be dragged back.** It is not misplaced; it is unrecoverable without clearing
storage.

So the clamp guarantees reachability rather than mere containment: the top edge is never above
zero, and at least `KEEP_VISIBLE` (56px) stays horizontally on screen. A property test asserts
that for any remembered position at all. The chat widget had the same latent bug and now shares
the fix.

---

## 2. Live collaboration

### Decisions taken up front

| Question | Decision |
|---|---|
| Reach | **LAN now, with a relay-ready seam.** A relay needs a backend that does not exist. |
| Whose disk | **The host's, only.** Guests never clone. They can *request* a commit; the host approves. |
| Merge engine | **Yjs.** A CRDT, added as a dependency. |
| Scope | Files, cursors, selections, follow-the-host, shared terminal (read-only and writable). |
| Topology | **A star through the host.** Never guest-to-guest. |

The star matters more than it looks. The host is already authoritative for the disk, so making it
authoritative for the protocol too means permission checks have exactly one place to live, there
is one socket to bind, and no NAT sits between guests. A mesh would multiply the authentication
surface by the number of participants for no gain on a LAN.

Yjs rather than a hand-rolled merge because concurrent text editing across three or more peers is
a genuine distributed-systems problem, and the failure mode of getting it slightly wrong is
**silent corruption of the user's source code**. Last-write-wins was rejected outright: it
contradicts the same-file concurrent editing that was asked for.

### Where the code lives

`packages/collab` is plain TypeScript - no Electron, DOM, Monaco, sockets, or Yjs - holding the
parts that actually break:

| Module | Responsibility |
|---|---|
| `protocol.ts` | The wire message union, and a `parse` returning `Message \| null`. |
| `permissions.ts` | Pure predicates. One place answers "is this allowed". |
| `session.ts` | The roster as a state machine: join, leave, role change, terminal grant. |
| `invite.ts` | Invite code encode/decode, and the token. |
| `colours.ts` | A colour per participant, from join order. |

`apps/desktop/src/main/collab/` holds what needs a socket or a disk: `transport.ts` (the seam),
`lanTransport.ts` (WebSocket), `docs.ts` (the Yjs documents and the file bridge), `runtime.ts`
(host and guest orchestration).

`apps/desktop/src/renderer/collab/` holds what needs Monaco: `binding.ts`, `deltas.ts`,
`remoteCursors.ts`, `collabPanel.ts`, `collabSession.ts`.

### Yjs sits on both sides of the IPC bridge

The renderer holds a replica bound to Monaco; main holds the authoritative replica that touches
disk and network. They sync using Yjs's own update format, which is transport-agnostic and
order-independent - so **the IPC bridge is just another Yjs provider.** Two consequences, both
deliberate:

- Local typing never waits on a round trip. Monaco applies the edit immediately.
- On save, main already holds the text. It never asks the renderer what the file says, so the
  host's authority over its own disk does not rest on trusting a renderer - which §1 says it
  must not.

The loop is guarded twice, because the two failures are different. A Yjs **origin tag** stops a
remote update being sent back out as though typed locally. An `applying` **flag** stops the
Monaco edit made in response to a remote change being read back as a new local edit - Monaco
fires its change event synchronously inside `pushEditOperations`, so without the flag every
remote character would be echoed to every peer, forever.

### Roles, enforced host-side

| Role | Can |
|---|---|
| Host | Everything. Owns disk, git, approvals. |
| Editor | Open, edit, save. Request a commit, not run one. |
| Viewer | Open, read, follow. |

**Enforcement lives in the host's main process, not in the guest's UI.** A greyed-out button on
someone else's machine is a hint to a cooperative peer and no obstacle at all to a modified one -
a guest's renderer is a computer the host does not administer. The order of checks on every
inbound message is fixed: does it parse, is the peer authenticated, is the peer allowed, then
act. An un-helloed peer may send exactly one kind of message.

`collabSession.test.ts` proves this by *not* asking the guest to behave: it tells the guest
runtime to send an update after being demoted, and asserts the host refused it and the file on
disk is untouched.

### Commit approval

A guest requests, the host sees the message and approves, and the commit runs under the host's
identity with `Co-authored-by: <guest>` appended - so the contribution is in the history even
though the host's machine made it.

### Security posture

This feature **inverts a documented decision.** `liveServer.ts` binds `127.0.0.1` and says
publishing a beginner's folder to every device on their network "is not a default anybody asked
for". That reasoning is still correct; collaboration is the case where the user did ask. So the
inversion is paid for:

1. **Never on by default.** A deliberate action starts a session, behind a confirmation that
   states in plain words what becomes reachable and by whom.
2. **Every message carries the session token.** An unauthenticated socket is closed before it
   touches any session state. The token is 24 bytes from `randomBytes`, never `Math.random`.
3. **Two guards on every peer-supplied path.** `protocol.ts` refuses traversal, drive letters,
   backslashes and NUL; the host then resolves and re-checks with `isInsideWorkspace`. Neither
   check subsumes the other - the first knows nothing about where the workspace is, the second
   nothing about what a well-formed message looks like.
4. **A plain HTTP request to the session port gets a flat 426** and volunteers nothing about the
   workspace, the session, or the product. This port is reachable from the network, so it will
   be probed.
5. **A new firewall rule**, with a planted-violation test: `packages/collab` and `packages/ads`
   may never import each other, in either direction. This is the sharpest edge in the
   repository - collab exists to send the user's source code to another machine, and ads
   promises that nothing from the user's code leaves it.

**LAN traffic is unencrypted.** Anyone positioned to capture packets sees the invite token and
then the file contents. On a home network that is the trust boundary the preview server already
assumes; on a café network it is not. The UI says so, in the panel, next to the address - rather
than letting a padlock-free interface imply safety by omission. TLS with a self-signed
certificate is the fix and it is **not built**.

One README correction falls out of this: the ad pipeline still sends nothing from the user's
machine, and collaboration sends code to explicitly invited peers. Those are different promises
and the document must not blur them.

### What is deliberately not built

- **The shared terminal.** Parsed, permission-checked, and refused with an honest reason. It is
  the piece with the remote-code-execution surface and it deserves its own pass rather than
  being finished last and least carefully. The permission model for it is complete and tested:
  `terminalWrite` is per-participant, never granted on join whatever the role, revoked
  automatically on demotion to viewer, and requires both the grant and an editing role.
- **Follow-the-host.** Presence carries the data; the viewport-following behaviour is not wired.
- **Guest-side create, delete and rename.** Editing existing files first; remote mutation of the
  file tree has a much larger blast radius.
- **A relay.** The seam is in place - `TransportFactory` - so adding one is a new file plus a
  settings row, with no change above it.
- Voice, video, session replay, and shared debugging (the DAP client does not exist).

### Testing

The test that decides whether the feature works is a **two-peer session over real sockets**,
both runtimes in one process, bound to loopback. Everything in `packages/collab` is a pure
function tested as one, but "two people type on the same line and both end up with the same
text" is a property of a host, a guest, a WebSocket, two Yjs documents and a permission check
behaving at once.

`deltas.ts` isolates the Monaco/Yjs index arithmetic, which is where an integration like this
actually breaks, and its round-trip property is checked against Yjs itself rather than against a
reading of its delta format.

---

## 3. The earnings report

A popover anchored to a new activity-bar button below Problems. It deliberately has **no
`data-view`**, unlike every button above it: both loops in `main.ts` that wire the activity bar
skip a button without one, which is what keeps a popover out of the sidebar's selection model.

The rule the panel is built around is **never show a number the server did not send.** The
balances are mirrored from `/v1/balance` and formatted by the ledger in integer arithmetic; the
per-preset hourly projections come pre-computed from `/v1/config` (deviation D1). Everything
else that an earnings screen would normally show cannot be built from what this machine knows:

- The receipt queue is an **outbox**, not a history - entries are deleted once the server accepts
  them. So it reports how much is *waiting to sync*, and is never labelled as a count of ads
  seen. Presenting it that way would make a successful sync look like lost earnings.
- Payout history, per-day reporting and statements need the advertiser backend, which does not
  exist. The panel says that in those words instead of drawing an empty chart, which would read
  as "you have earned nothing".

A figure the server has sent is drawn in `--success`; an unknown one is a dash in
`--text-tertiary`, driven by an explicit `data-known` attribute rather than inferred from the
rendered string. So "we have not heard" and "you earned nothing" never render alike.

---

## 4. Why the icons were off-centre

Reported as "some of the buttons have icons that are not centred". The cause was not the
buttons.

Four controls drew their close icon as the **text character `×` (U+00D7 MULTIPLICATION SIGN)** -
a mathematical operator, positioned by the font on the maths axis, around the height of a minus
sign and centred on the x-height rather than the em box. It renders visibly high in a square
button no matter what CSS says. `.scm-stage` did the same with `+` and `−`, and
`.problems-glyph` swapped `✕`/`!`/`i` into one circle, three glyphs with three different widths
and vertical extents. All of these are now stroked paths from a single `icons.ts`, drawn
symmetric about (8, 8) in a 16×16 viewBox - geometry has no baseline and no font metrics.

But the measured error was elsewhere. `npm run smoke` was taught to compare each icon's centre
against its button's centre in a real laid-out window, and it reported `.tree-action` off by
**3px** and `.tab-close` by **2.5px**, horizontally only. The cause:

> **The user agent gives every `<button>` `padding: 1px 6px`.**

Every icon button already declared `display: grid; place-items: center`, and every one honoured
it exactly - centring the icon inside the *content box*. With `box-sizing: border-box` and twelve
pixels of horizontal padding, a 16px close button has a **4px** content box, so a 9px icon does
not fit in the area being centred and an overflowing grid item overflows one way. The vertical
padding is 1px and symmetric, so it did no damage; the horizontal 6px did. That is the
fingerprint the measurement exposed and eyeballing never would.

One `button { padding: 0 }` in the reset is the whole fix, and it is safe globally because every
button in this app that wants padding declares its own - the ones that do not are precisely the
fixed-size icon controls that must not have any.

Two smoke checks now guard it: one asserts geometric centring across every icon-only control in
every view, and one asserts no control draws its icon as a text character - because a button
holding `×` has no `svg` at all, so the first check would skip it and pass.
