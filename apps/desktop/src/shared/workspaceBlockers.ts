/**
 * The one message the main process sends when a file tool is blocked because no folder is
 * open. The chat recognizes this exact text to offer "Open a folder" as a way out (see
 * chatWidget's workspace nudge), so main and renderer must not paraphrase each other -
 * the nudge silently dies the moment one side rewords it.
 *
 * Issue bluethenics/adcode#11: with no folder open the tool failure used to arrive with no
 * way forward, and the person only learned file tools were unavailable after the request
 * had already failed.
 */
export const NO_FOLDER_BLOCKER = "Open a folder before using AI file tools.";