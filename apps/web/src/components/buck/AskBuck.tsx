"use client";

/**
 * Buttons that hand Buck a question. The companion in the corner (BuckGuide) listens for the
 * `adcode:buck-ask` event, opens his bubble and answers through Tagflow, so a page never needs
 * its own chat box: it only says what people usually want to ask there.
 */
export const BUCK_ASK_EVENT = "adcode:buck-ask";

export function askBuck(question: string): void {
  window.dispatchEvent(new CustomEvent<string>(BUCK_ASK_EVENT, { detail: question }));
}

export function AskBuck({ questions, label = "Ask Buck" }: { questions: readonly string[]; label?: string }) {
  return (
    <div className="ask-buck" role="group" aria-label={label}>
      <span className="ask-buck-label">{label}</span>
      {questions.map((question) => (
        <button key={question} type="button" onClick={() => askBuck(question)}>{question}</button>
      ))}
    </div>
  );
}
