/**
 * The first prompt: the person's idea, plus what a new project needs to run at once.
 *
 * A first build that ends with "now run `npm install`" on a machine with no Node is a first
 * build that does not run. Unless the idea names a framework, a new project is built as
 * plain HTML, CSS and JavaScript with an `index.html` at the top - which the preview shows
 * the moment it exists - and the assistant is asked to open the preview and check it.
 */

/** Words that mean the person chose their own stack, which the suffix must not overrule. */
const NAMES_A_STACK = /\b(react|next(\.js)?|vue|nuxt|svelte|angular|astro|vite|node|express|python|flask|django|fastapi|rust|go|golang|java|kotlin|swift|flutter|electron|tauri|typescript|tailwind|php|laravel|ruby|rails|c\+\+|c#|\.net|unity|godot)\b/i;

export function firstBuildPrompt(idea: string, newProject: boolean): string {
  const text = idea.trim();
  if (!newProject) return `${text}\n\nBuild this in my project, then run it and check that it works.`;
  const stack = NAMES_A_STACK.test(text)
    ? "Use the stack I named."
    : "Use plain HTML, CSS and JavaScript with an index.html at the top, so it runs without installing anything.";
  return `${text}\n\nThis is a brand-new, empty project folder. ${stack} Make it look polished and work fully, then open it in the preview and check it works.`;
}

/**
 * Whether a message sent with no folder open is asking for something to be built.
 *
 * Only then does ADCode make a project folder for it. "What is a closure?" with no folder
 * open is a question, and answering it should not leave an empty folder in Documents.
 */
export function looksLikeBuildRequest(text: string): boolean {
  return /^\s*(please\s+)?(build|make|create|generate|code|design|develop|write|set up|start)\b/i.test(text) ||
    /\b(an?|my)\s+(app|website|site|web ?page|landing page|game|portfolio|dashboard|tool|extension|bot|clone|tracker|calculator)\b/i.test(text);
}
