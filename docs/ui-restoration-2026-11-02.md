# Sidebar and account UI restoration

This supersedes the sidebar, account presentation and shared-project UI sections of `app-onboarding-project-chats-2026-11-02.md`. Account sign-in, server-verified email and first-time onboarding remain required. The desktop build is local; this task has not published an installer.

| Before | After | Why |
| --- | --- | --- |
| Icon-only sidebar rows and footer | Original labeled navigation, footer links and Open IDE card | Restore the requested familiar UI |
| Shared project chats, rail entry and sharing menu actions | Shared workspace is no longer mounted; sharing entry points and feature card are hidden | Pause the feature without deleting stored projects or chats |
| Account update could interrupt the startup verification request | Serialized checks queue updates and reject stale results | Verified users resume automatically; sign-out cannot unlock from an old response |
| Verification required an extra Ready screen | Verification continues straight into the original first-build onboarding, or the app if already completed | Keep login and onboarding while removing repeated steps |
| Cancelled provider results could overwrite a retry | Only the current sign-in attempt updates its controls and status | Google/GitHub retries remain clear |
| Incomplete or failed welcome-file reads could repeat setup | Missing files identify fresh installs; existing unreadable records follow the documented returning-user policy; completion writes atomically | Remember completed onboarding reliably |

The sign-in gate follows the supplied Codex visual reference with ADCode branding, a neutral ASCII field, Google/GitHub pill buttons and pointer feedback. The existing account popover and first-build onboarding retain their established UI. Pointer feedback is event-driven and stops on close; system and app reduced-motion settings are honored. Chat hover previews remain available, and inaccurate remaining-percentage badges stay removed.

An active collaboration session retains its management/disconnect control. No new sharing entry is exposed in navigation, menus, the command palette or All Features. Local projects and server-side shared data are preserved.

## Validation

- Automated account tests cover Google PKCE and browser fallback, GitHub device authorization, email/password linking and account switching, verification delivery/error handling, token persistence and renewal.
- Electron UI fixtures exercise required login, blocked Escape dismissal, provider pending/error/cancel/retry, explicit email verification, automatic continuation, cold-start verification broadcasts, sign-out during a pending check, first onboarding and remembered completion.
- Sidebar fixture verifies visible labels, vertical footer rows, the restored IDE card and absence of the shared-project entry. Previews: `output/sidebar-restored.png`, `output/account-journey-signin.png`, `output/account-journey-verification.png`.
- Desktop type check and production build pass. Dependency check: 0 errors, 36 existing warnings.
- Read-only production checks: `/desktop-sign-in` loads successfully; `/v1/ai/account/verification` returns 401 without authentication.
- Automated provider/account tests use synthetic credentials. This run has not completed Google/GitHub OAuth with a real account or sent a real verification email.

## References

- [Firebase: Google sign-in](https://firebase.google.com/docs/auth/web/google-signin)
- [Firebase: GitHub sign-in](https://firebase.google.com/docs/auth/web/github-auth)
- [GitHub: authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [MDN: reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
- [Emil Kowalski's design skills](https://github.com/emilkowalski/skills/)
- [Unslop by Damir Sokolovsky](https://github.com/heydamir/unslop/tree/main), CC BY 4.0.
