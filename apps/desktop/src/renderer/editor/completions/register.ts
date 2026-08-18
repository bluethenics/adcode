/**
 * Hand the keyword tables to Monaco.
 *
 * The tables live in `keywords.ts`, which has no Monaco import and is tested without a
 * window. This file is the adapter, and is deliberately the only part that knows what a
 * `CompletionItemKind` is - the same split as `markerAdapter.ts` and the Problems panel.
 */
import * as monaco from "monaco-editor";
import { languagesWithKeywords, matching, suggestionsFor, type SuggestionKind } from "./keywords.ts";

const KIND: Readonly<Record<SuggestionKind, monaco.languages.CompletionItemKind>> = {
  keyword: monaco.languages.CompletionItemKind.Keyword,
  snippet: monaco.languages.CompletionItemKind.Snippet,
  function: monaco.languages.CompletionItemKind.Function,
};

export function registerKeywordCompletions(): monaco.IDisposable {
  return monaco.languages.registerCompletionItemProvider(languagesWithKeywords(), {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);

      /*
       * The range must cover the word already typed, not just the cursor. Without it
       * Monaco inserts the completion *after* what the user typed - `de` + `def` becomes
       * `dedef` - which looks like the editor is broken rather than helping.
       */
      const range = new monaco.Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );

      const suggestions = matching(suggestionsFor(model.getLanguageId()), word.word).map(
        (item) => ({
          label: item.label,
          kind: KIND[item.kind],
          detail: item.detail,
          insertText: item.insert,
          // Every entry goes in as a snippet. A plain keyword contains no `${}` so it
          // behaves identically, and a single rule means a table entry can grow tab stops
          // later without anyone remembering to change a flag here.
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        }),
      );

      return { suggestions };
    },
  });
}
