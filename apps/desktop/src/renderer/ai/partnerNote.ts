/**
 * "Tag Flow AI is an ADCode partner. Their Privacy Policy and Terms apply when you use their
 * models." - with both documents linked, wherever a partner's model is offered or in use: the
 * welcome, Connect a model and the chat composer. The words live in `shared/tagflow.ts`, where
 * they are tested; this only builds them. Links open in the browser (https, `_blank`).
 */
import { partnerNoteSegments, type PartnerView } from "../../shared/tagflow.ts";

export function partnerNoteElement(partner: PartnerView, className: string): HTMLElement {
  const note = document.createElement("p");
  note.className = className;
  fillPartnerNote(note, partner);
  return note;
}

/** Replace what `note` says with the partner's notice. */
export function fillPartnerNote(note: HTMLElement, partner: PartnerView): void {
  note.replaceChildren();
  for (const segment of partnerNoteSegments(partner)) {
    if ("href" in segment) {
      const link = document.createElement("a");
      link.href = segment.href;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = segment.text;
      note.append(link);
    } else {
      note.append(segment.text);
    }
  }
}
