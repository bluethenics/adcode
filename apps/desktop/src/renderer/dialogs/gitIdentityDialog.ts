/**
 * Who git records commits as - asked for in the window, not in a terminal.
 *
 * Reported by the user: Commit & Push said "Git needs a name and email... open the terminal
 * and run git config", on a machine where git was "all set up" and VS Code committed fine.
 * His global config said `user.mail`, a slip git ignores, so git had a name and no email;
 * and other tools hand git an email of their own. The advice was correct and useless.
 *
 * So the commit asks here, prefilled with the best guesses git can offer - the misspelt
 * key's value, the email this person's earlier commits in the project used - saves the
 * answer in git's own config (so every other tool sees it too), and the commit carries on.
 */
import { button, el, field, openFormModal } from "./formDialog.ts";

export interface GitIdentityRequest {
  /** One sentence above the form: why it is being asked now. */
  readonly reason?: string;
  /** Offer "this project only" as well as every project. False when no folder is open. */
  readonly allowLocal?: boolean;
}

/** Ask for a name and email and save them. Resolves true once git has them. */
export async function askGitIdentity(request: GitIdentityRequest = {}): Promise<boolean> {
  const identity = await window.adcode.git.identity().catch(() => null);

  return new Promise((resolve) => {
    let saved = false;
    const { dialog, card, finish } = openFormModal("git-identity-dialog", "Who are commits from?", () => resolve(saved));

    card.append(el("p", "result-summary", request.reason ?? "Git records a name and email with every commit."));
    if (identity?.typo !== null && identity?.typo !== undefined) {
      card.append(
        el(
          "p",
          "git-identity-typo",
          `Your git settings have ${identity.typo.key} = ${identity.typo.value}. Git only reads user.email, so it has no email for you. Saving below fixes that.`,
        ),
      );
    }

    const form = el("form", "form-dialog-form");
    const name = el("input", "form-input");
    name.type = "text";
    name.autocomplete = "name";
    name.required = true;
    name.maxLength = 200;
    name.value = identity?.name ?? identity?.suggestedName ?? "";

    const email = el("input", "form-input");
    email.type = "email";
    email.autocomplete = "email";
    email.required = true;
    email.value = identity?.email ?? identity?.suggestedEmails[0] ?? "";
    const suggestions = identity?.suggestedEmails ?? [];
    if (suggestions.length > 1) {
      const list = el("datalist", "");
      list.id = "git-identity-emails";
      for (const address of suggestions) {
        const option = el("option", "");
        option.value = address;
        list.append(option);
      }
      email.setAttribute("list", list.id);
      form.append(list);
    }

    const everywhere = el("input", "");
    everywhere.type = "checkbox";
    everywhere.checked = true;
    const scope = el("label", "agents-check git-identity-scope");
    scope.append(everywhere, document.createTextNode("Use for all my projects"));
    scope.hidden = request.allowLocal === false;

    const notice = el("p", "form-notice");
    notice.setAttribute("role", "alert");
    notice.hidden = true;

    const save = el("button", "result-close", "Save and continue");
    save.type = "submit";
    const buttons = el("div", "confirm-buttons");
    buttons.append(button("Cancel", "confirm-cancel", finish), save);

    form.append(
      field("Name", name),
      field(
        "Email",
        email,
        suggestions.length > 1 ? "Pick one you have used before, or type another." : "Saved in git's settings, so VS Code and the terminal use it too.",
      ),
      scope,
      notice,
      buttons,
    );
    card.append(form);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      notice.hidden = true;
      save.disabled = true;
      const where = request.allowLocal === false || everywhere.checked ? "global" : "local";
      void window.adcode.git.setIdentity(name.value, email.value, where).then(
        (outcome) => {
          if (outcome.ok) {
            saved = true;
            finish();
            return;
          }
          notice.hidden = false;
          notice.textContent = outcome.message;
          save.disabled = false;
        },
        (error: unknown) => {
          notice.hidden = false;
          notice.textContent = error instanceof Error ? error.message : "Could not save that. Try again.";
          save.disabled = false;
        },
      );
    });

    dialog.showModal();
    (name.value.trim() === "" ? name : email.value.trim() === "" ? email : save).focus();
  });
}
