"use client";

import { useRef, useState } from "react";

/**
 * Drop a logo in, get a square PNG back.
 *
 * Advertisers used to have to type an https URL for their own logo, which meant hosting a
 * PNG somewhere before they could run an ad. That is a step that loses people who were
 * otherwise ready to pay.
 *
 * The file never leaves the browser as a file. It is drawn into a 128x128 canvas and
 * handed back as a `data:` URL, which the API stores on the creative row (see
 * `logoSource` in `services/api/src/contract.ts`, which accepts only PNG, JPEG and WebP -
 * an SVG `data:` URL carries script, and would run wherever the card is rendered).
 *
 * 128px because that is four times the size the card actually draws it at, so it stays
 * sharp on a Retina display and still lands around 8-15KB - comfortably inside the 64KB
 * the API accepts, without asking anyone to think about file size.
 */
const SIZE = 128;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;

export interface LogoDropProps {
  label: string;
  hint?: string;
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}

async function toSquarePng(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);

  try {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;

    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2d context");

    // Fitted inside the square rather than stretched to it. A wordmark squashed into a
    // circle is worse than a wordmark with air around it, and the card draws whatever
    // this returns without asking questions.
    const scale = Math.min(SIZE / bitmap.width, SIZE / bitmap.height);
    const width = bitmap.width * scale;
    const height = bitmap.height * scale;

    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, (SIZE - width) / 2, (SIZE - height) / 2, width, height);

    // PNG, so transparency survives - a logo on a white block would sit badly on both
    // the light and the dark card.
    return canvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}

export function LogoDrop({ label, hint, value, onChange }: LogoDropProps) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const take = async (file: File | undefined): Promise<void> => {
    setError(null);
    if (file === undefined) return;

    if (!file.type.startsWith("image/")) {
      setError("That isn't an image. PNG, JPEG, or WebP.");
      return;
    }
    if (file.size > MAX_INPUT_BYTES) {
      setError("That file is very large. Try one under 8MB.");
      return;
    }

    try {
      onChange(await toSquarePng(file));
    } catch {
      // A corrupt file, or a format the browser will not decode. Neither is worth an
      // error code - what the person needs to know is to try a different file.
      setError("Couldn't read that image. Try another file.");
    }
  };

  return (
    <div className="field">
      <label htmlFor={`logo-${label}`}>{label}</label>
      {hint !== undefined && <span className="field-hint">{hint}</span>}

      <div
        className="logo-drop"
        data-over={over ? "true" : undefined}
        data-filled={value !== null ? "true" : undefined}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          void take(event.dataTransfer.files[0]);
        }}
      >
        {value === null ? (
          <>
            <span className="logo-drop-icon" aria-hidden="true">
              ↑
            </span>
            <span className="logo-drop-text">Drop a logo, or</span>
            <button type="button" className="btn btn-outline btn-small" onClick={() => input.current?.click()}>
              Choose a file
            </button>
          </>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL, already
                the exact size it renders at; next/image would proxy it for nothing. */}
            <img src={value} alt="" className="logo-drop-preview" width={64} height={64} />
            <div className="logo-drop-actions">
              <button type="button" className="btn btn-outline btn-small" onClick={() => input.current?.click()}>
                Replace
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => onChange(null)}>
                Remove
              </button>
            </div>
          </>
        )}

        <input
          ref={input}
          id={`logo-${label}`}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(event) => {
            void take(event.target.files?.[0]);
            // Cleared so choosing the same file twice still fires a change event, which
            // is what someone does after deciding the first crop was wrong.
            event.target.value = "";
          }}
        />
      </div>

      {error !== null && (
        <span className="field-hint" data-tone="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
