# Your first project in a BYOK AI editor: an ADCode checklist

Disclosure: this guide was generated with AI assistance from ADCode's product documentation for the official ADCode account. It describes documented features, rather than a recorded hands-on test.

A useful first test of an editor is a small task you can finish and inspect. For ADCode, start with a separate practice folder: create a plain web page, change one feature, preview it, and save a Git checkpoint. This lets you evaluate the workflow before moving an important project.

## 1. Install the editor and understand the costs

ADCode is a free, open-source desktop editor for Windows and Linux. Windows downloads use Microsoft Store. Linux downloads include a Debian/Ubuntu package and an x86-64 AppImage. Choose the appropriate build on [ADCode's download page](https://adcode.bluethenics.com/versions?utm_source=medium&utm_medium=article&utm_campaign=oct04_first_task). This link leaves Medium and opens ADCode's own website.

The editor and AI inference have separate costs. ADCode supports a provider you connect with your own key, or a compatible local model. A cloud provider may charge for usage. Sponsored cards fund the editor; revenue credits are variable and are not a reason to leave the application running.

## 2. Open a practice folder

Create an empty folder for the exercise, then use File → Open Folder. A separate folder makes the changes easy to inspect and discard.

If you already have a small project, use a copy or a separate Git branch for your first test. Keep secrets and sensitive material out of the exercise.

## 3. Connect a model

Press Ctrl+Shift+P and search for Connect a model. Choose your provider, enter its API key, select Check and save, and choose a model. Check the provider's own prices and account limits before sending requests.

For a local alternative, ADCode's Ollama adapter uses http://127.0.0.1:11434/v1 by default and does not require an API key. Ollama must already be running with a suitable model. A custom OpenAI-compatible connection needs its base URL and exact model ID.

## 4. Ask for one inspectable change

Open Assistant and try a small request such as:

> Create a plain HTML page with a heading and a button. Each click should increment a visible counter. Use ordinary HTML, CSS and JavaScript without dependencies.

This is a suggested exercise, not a claim that a particular model has been tested with it. Inspect the proposed files and changes before keeping the result. If the model introduces packages or unrelated work, ask it to simplify the change.

## 5. Check the result

Open the HTML file and use Live preview. Click the button and check that the counter changes. Save an edit to the heading and check the preview again.

For an existing project, use Terminal → New Terminal to run its usual build or tests. Review commands before running them; an AI-generated change does not establish that the project works.

## 6. Save a checkpoint and assess the friction

If the folder has no Git repository, choose Git → Initialise Repository. Open Source Control, inspect the diffs, stage the intended files, enter a commit message, and select Commit. Pushing to a remote is a separate step that needs a configured remote and credentials.

You now have a concrete basis for evaluating the editor: installation, provider setup, editing, preview, terminal work, and Git. The useful feedback is where that sequence becomes confusing or unreliable. Share your operating system, provider or local model, and the step that failed. Never include API keys or private project material in public comments.

---

Publication note for the owner: publish manually if useful. Medium prohibits automated posting and limits distribution of generated content and content marketing. Keep the disclosure and leave this article outside the Partner Program paywall. No claim of same-day traffic is implied.

Verification note: the workflow is grounded in current local documentation (apps/web/src/lib/docsGuides.ts; packages/help/src/entries/ai.ts, workbench.ts and git.ts). The live public documentation was inaccessible to the research tool, so confirm menu names against the released build before publishing.
