/** Monaco adapter for ADCode's cancellable provider-backed ghost text. */
import * as monaco from "monaco-editor";
import { IDLE_MS } from "@adcode/ai/completion";
import { completionContextAt } from "./inlineCompletionContext.ts";

export interface AiInlineCompletion {
  setEnabled(enabled: boolean): void;
  trigger(): void;
  dispose(): void;
}

export function installAiInlineCompletion(
  editor: monaco.editor.IStandaloneCodeEditor,
  eligible: (model: monaco.editor.ITextModel) => boolean,
): AiInlineCompletion {
  let enabled = true;
  let nextRequestId = 1;

  const provider = monaco.languages.registerInlineCompletionsProvider("*", {
    displayName: "ADCode AI",
    debounceDelayMs: IDLE_MS,

    async provideInlineCompletions(model, position, context, token) {
      if (!enabled || !context.includeInlineCompletions || !eligible(model) || token.isCancellationRequested) {
        return null;
      }

      const offset = model.getOffsetAt(position);
      const requestId = nextRequestId++;
      const version = model.getVersionId();
      const input = {
        requestId,
        ...completionContextAt(model.getValue(), offset, model.getLanguageId()),
      };
      const cancellation = token.onCancellationRequested(() =>
        window.adcode.ai.cancelCompletion(requestId),
      );

      try {
        let text = await window.adcode.ai.complete(input);
        if (
          text === null ||
          token.isCancellationRequested ||
          model.getVersionId() !== version ||
          !eligible(model)
        ) {
          return null;
        }

        // Monaco accepts multiline ghost text only at the physical line end. Mid-line,
        // keep the useful first line instead of asking it to replace code after the caret.
        if (text.includes("\n") && position.column < model.getLineMaxColumn(position.lineNumber)) {
          text = text.split(/\r?\n/, 1)[0] ?? "";
        }
        if (text.length === 0) return null;

        return {
          items: [
            {
              insertText: text,
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column,
              ),
            },
          ],
        };
      } finally {
        cancellation.dispose();
      }
    },

    disposeInlineCompletions() {},
  });

  return {
    setEnabled(next) {
      enabled = next;
      editor.updateOptions({ inlineSuggest: { enabled: next } });
      if (!next) editor.trigger("settings", "editor.action.inlineSuggest.hide", undefined);
    },
    trigger() {
      if (!enabled) return;
      editor.focus();
      editor.trigger("user", "editor.action.inlineSuggest.trigger", undefined);
    },
    dispose: () => provider.dispose(),
  };
}
