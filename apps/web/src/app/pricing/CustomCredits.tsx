"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import Link from "@/components/IntentLink";
import { Icon } from "@/components/Icon";
import { ArrowUpRight } from "lucide";
import { Buck } from "@/components/buck/Buck";
import type { AdcodeMascot } from "@/components/buck/adcodeMascot";
import { WALLET_CUSTOM_MAX_CENTS, WALLET_CUSTOM_MIN_CENTS, WALLET_TOPUPS_CENTS } from "@/lib/pricing";

const MIN = WALLET_CUSTOM_MIN_CENTS / 100;
const MAX = WALLET_CUSTOM_MAX_CENTS / 100;

/** Slider position (0-1000) to dollars on a log scale, so $5-$50 is not crushed into a sliver. */
const toDollars = (position: number): number => Math.round(MIN * Math.pow(MAX / MIN, position / 1000));
const toPosition = (dollars: number): number => Math.round((Math.log(dollars / MIN) / Math.log(MAX / MIN)) * 1000);

/** A typed amount, or null with the reason it cannot be paid. */
export function parseAmount(raw: string): { dollars: number } | { error: string } {
  const value = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (value === "") return { error: `Enter an amount from $${MIN} to $${MAX.toLocaleString("en-US")}.` };
  if (!/^\d+$/.test(value)) return { error: "Whole dollars only, like 25." };
  const dollars = Number(value);
  if (dollars < MIN) return { error: `The smallest amount is $${MIN}.` };
  if (dollars > MAX) return { error: `The largest single amount is $${MAX.toLocaleString("en-US")}.` };
  return { dollars };
}

/**
 * "Pay what you need": any whole-dollar amount from $5 to $1,000, paid once. The checkout charges
 * exactly the number shown (plus tax, which Dodo shows before payment), and the link carries the
 * amount to AI credits, where checkout opens after sign-in.
 */
export function CustomCredits() {
  const id = useId();
  const [text, setText] = useState("25");
  const buck = useRef<AdcodeMascot | null>(null);
  const parsed = parseAmount(text);
  const dollars = "dollars" in parsed ? parsed.dollars : null;
  const tier = dollars === null ? "none" : dollars >= 500 ? "huge" : dollars >= 100 ? "big" : dollars >= 25 ? "mid" : "small";
  const last = useRef(tier);

  // Buck reacts once each time the amount crosses into a new band, never on every keystroke.
  useEffect(() => {
    if (last.current === tier) return;
    last.current = tier;
    const mood = ({ none: "surprised", small: "wink", mid: "earning", big: "proud", huge: "dancing" } as const)[tier];
    buck.current?.play(mood, 1400);
  }, [tier]);

  const position = dollars === null ? toPosition(25) : toPosition(dollars);
  return (
    <section className="pricing-custom" aria-labelledby={`${id}-heading`}>
      <div className="pricing-custom-copy">
        <p className="pricing-eyebrow">Pay as you go</p>
        <h2 id={`${id}-heading`}>Or choose your own amount</h2>
        <p>Add USD credits once, any whole amount from ${MIN} to ${MAX.toLocaleString("en-US")}. They never expire, nothing renews, and they pay for any model at the price listed for it.</p>
        <ul className="pricing-custom-facts">
          <li>Charged only for what each request used</li>
          <li>Works alongside a plan, or without one</li>
        </ul>
      </div>
      <div className="pricing-custom-picker">
        <div className="pricing-custom-amount">
          <Buck mood="earning" size={64} interactive label="Buck, counting your credits. Tap him." onReady={(instance) => { buck.current = instance; }} />
          <label htmlFor={`${id}-amount`} className="pricing-custom-field">
            <span className="sr-only">Amount in US dollars</span>
            <span aria-hidden="true">$</span>
            <input
              id={`${id}-amount`}
              inputMode="numeric"
              autoComplete="off"
              value={text}
              aria-invalid={dollars === null}
              aria-describedby={`${id}-hint`}
              onChange={(event) => setText(event.target.value.replace(/[^\d$,]/g, "").slice(0, 6))}
            />
          </label>
        </div>
        <input
          className="pricing-finder-range"
          type="range"
          min={0}
          max={1000}
          step={1}
          value={position}
          aria-label="Amount"
          aria-valuetext={`$${dollars ?? 25}`}
          onChange={(event) => setText(String(toDollars(Number(event.target.value))))}
          style={{ "--fill": `${position / 10}%` } as CSSProperties}
        />
        <div className="pricing-custom-chips" role="group" aria-label="Common amounts">
          {WALLET_TOPUPS_CENTS.map((cents) => (
            <button key={cents} type="button" data-active={dollars === cents / 100} onClick={() => setText(String(cents / 100))}>${cents / 100}</button>
          ))}
        </div>
        <p id={`${id}-hint`} className={dollars === null ? "pricing-custom-error" : "pricing-small"} role={dollars === null ? "alert" : undefined}>
          {"error" in parsed ? parsed.error : `$${dollars!.toLocaleString("en-US")} of credits, paid once. Tax, if any, is shown before you pay.`}
        </p>
        {dollars === null ? (
          <span className="pricing-button" aria-disabled="true" data-primary="true">Add credits</span>
        ) : (
          <Link href={`/ai-tokens?amount=${dollars}&go=1#wallet`} className="pricing-button" data-primary="true" data-buck="earning">
            Add ${dollars.toLocaleString("en-US")} of credits <Icon node={ArrowUpRight} />
          </Link>
        )}
      </div>
    </section>
  );
}
