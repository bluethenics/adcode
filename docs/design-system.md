# Adcode visual system

The supplied references define the visual direction: navy-black backgrounds, layered
slate controls, blue primary actions, rounded panels, subtle highlights and shadows,
system typography, and visible keyboard focus. The welcome view uses compact launch
cards and the “Code. Build. Earn.” identity. Existing navigation and tools retain their
workflows; the weather and other sample widgets live only in the component gallery.

Open [the interactive gallery](design-system.html) in a browser to review components,
switch themes and density, and exercise keyboard controls. It loads the desktop's
actual stylesheets; it is not a separately styled mockup.

## Repository inventory

| Area | Implementation | Styling / reusable pieces |
| --- | --- | --- |
| Desktop | Electron + electron-vite, TypeScript DOM factories | `renderer/styles/tokens.css`, `design-system.css` |
| Workbench | `main.ts`, `workbench/`, `index.html` | `workbench.css`, `editorWorkspace.css`, `navigation.css` |
| Editor / terminal | Monaco / xterm | Editor theme definitions in `editorHost.ts`; ANSI palette in `terminalHost.ts` |
| Settings | DOM factories, native inputs, segmented controls | `settings.css`, `themePicker.ts` |
| AI / connections | DOM factories and existing state models | `ai.css`, shared `.btn` variants |
| Menus / popups | Existing keyboard menu and popup-shell implementations | `menubar.css`, `popupShell.css`, `popups.css` |
| Dialogs / notifications | Existing dialog factories and notification centre | `dialogs.css`, `notifications.css`, `releases.css` |
| Other desktop tools | Source control, search, diagnostics, collaboration, debug, help, feature library | `panels.css`, `structure.css`, `help.css`, `features.css` |
| Website / portals | Next.js App Router + React, reusable `components/ios/` controls | `app/globals.css`, `app/design-system.css`, `AppShell`, `AdminShell` |
| Services / packages | Backend, AI providers, ads, settings, search, etc. | No independent rendered UI to restyle |

## Tokens and layering

Desktop `tokens.css` owns semantic background, text, accent, state, spacing, radius,
shadow, density, and motion tokens. Light, dark, midnight, and system appearance remain
available. Dark is the reference appearance; selecting it does not change the user's
other preferences. Code and terminal ANSI syntax colors preserve their meaning.

- Surfaces: `--bg-app`, `--bg-chrome`, `--bg-editor`, `--bg-elevated`.
- Controls: `--surface-control`, `--surface-control-hover`, `--surface-selected`.
- Material: `--surface-sheen`, `--shadow-control`, `--shadow-floating`.
- Actions: `--fill-primary`, `--fill-danger`, `--focus-ring`.
- Spacing: `--space-1` through `--space-6`: 4, 8, 12, 16, 24, 32 pixels.
- Shape: small 10px, medium/panel 14px, large 20px.
- Type: platform system UI font, separate code font, 11–28px base scale.
- Density: `--control-height` is 34px comfortable / 28px compact. Existing dense
  editor and toolbar controls keep their local geometry.

Feature styles own layout; `design-system.css` is imported last and owns shared
appearance. Explicit selector aliases connect existing component classes to the
recipes without replacing event handlers or DOM. Avoid unscoped `input` or `button`
appearance overrides: Monaco, terminal helpers, and window controls need their own
geometry. Do not duplicate the full recipe in new feature styles.

The web companion keeps its existing class API and responsive layout. Its
`design-system.css` maps the same palette and material decisions onto those classes,
including portal navigation, forms, cards, segmented controls, and notices.

## Component contracts

| Component | Recipe | Usage |
| --- | --- | --- |
| Buttons | `.ad-btn`, `-primary`, `-tertiary`, `-destructive` | Native button; use `disabled` for disabled state |
| Icon buttons | `.ad-icon-btn` | Supply an accessible label; `aria-pressed` for toggle state |
| Switch | `.ad-switch > input[type=checkbox]` | Wrap in a label; use `role=switch`; existing `.ios-switch` remains supported |
| Checkbox / radio | `.ad-check`, `.ad-radio` | Label wrapping a native input; group radios with `name` |
| Fields | `.ad-field`, `.ad-input`, `.ad-textarea`, `.ad-select` | Visible label; native form behavior; use `aria-invalid` for validation |
| Search | `.ad-search` | SVG icon plus labeled native search input |
| Slider | `.ad-slider` | Native range input; update `--progress` to its normalized percentage on input |
| Tabs | `.ad-tabs`, `.ad-tab` | Existing tab controller supplies roles, selected state, arrow keys, and panels |
| Navigation | `.ad-nav`, `.ad-nav-item` | Links with `aria-current=page`; existing activity rail retains its controller |
| Cards | `.ad-card`, `.ad-card-row`, `.ad-card-icon`, `.ad-card-copy` | Use a native button or link only when interactive |
| Dialog | `.ad-dialog` | Native `dialog.showModal()` with accessible title; existing app dialog factories remain preferred |
| Menus | `.ad-menu`, `.ad-menu-item`, `.ad-menu-kbd` | Use the existing `contextMenu.ts` / `menuBar.ts` keyboard and positioning logic in the app |
| Notifications | `.ad-notif`, `.ad-notif-dot`, `.ad-notif-copy` | `data-tone=success/info/warning/error`; announce actual events, not static examples |
| Progress | `.ad-progress` | Native `progress` or a span-based meter with progressbar semantics |
| Tooltip | `.ad-tooltip` | Associate via `aria-describedby`; expose on focus and hover |
| Scrollbars | `.ad-scroll` | Put on the actual scrolling container |
| Widgets | `.ad-widget`, `.ad-widget-weather` | Presentation only; render real data or label examples explicitly |

Keep accessible names, focus handling, keyboard navigation, dismissal, and application
state in the existing factories. CSS alone does not implement those behaviors.
Reduced motion, reduced transparency, increased contrast, and forced colors have
explicit fallbacks. Native disabled inputs remain native and noninteractive.

## Verification

Run `npm run desktop:build`, `npm run typecheck`, and
`npx vitest run apps/desktop/test`. `node scripts/smoke.mjs --visual-only` checks
theme/density switching, keyboard navigation, zoom, reduced motion and forced colors
in the actual Electron app. `npm run smoke` exercises broader application workflows.

`npm run design:check` launches Electron, renders this gallery in all
three themes, checks native control behavior and narrow layouts, and saves screenshots
and `results.json` to a newly created temporary directory. It uses a separate profile.
Optionally use `npm run design:check -- http://localhost:3100/download` to capture the
companion website at desktop and phone sizes. Build the web app with
`npm run web:build` before previewing it. Authenticated portal screens require an
appropriate signed-in account for visual review; the checker does not bypass sign-in.
