"use client";

import { useMemo, useState } from "react";

export interface PaidModelPrice {
  id: string;
  name: string;
  provider: string;
  available: boolean;
  inputPrice: number;
  outputPrice: number;
  cacheInputPrice: number;
  /** Missing where the provider has no separate cache-write price; the column then hides. */
  cacheWritePrice?: number;
}

const price = (value: number) => `$${Number(value.toFixed(5))}`;
/** The regular price behind an offer price, matching regularPrice in lib/pricing. */
const regular = (value: number, percent: number) => value * 100 / (100 - percent);

/** One price: during an offer, the regular price struck through above the one you pay. */
function Rate({ value, offerPercent }: { value: number; offerPercent?: number | undefined }) {
  if (offerPercent === undefined || value === 0) return <>{price(value)}</>;
  return <span className="model-price-offer">
    <s className="model-price-regular"><span className="model-prices-sr-only">Regular price </span>{price(regular(value, offerPercent))}</s>
    <span><span className="model-prices-sr-only">Offer price </span>{price(value)}</span>
  </span>;
}
const routed = (model: PaidModelPrice) => model.provider.toLowerCase() === "openrouter";
const ALL_RATES = [
  ["Input", "inputPrice"],
  ["Cached input", "cacheInputPrice"],
  ["Cache writes", "cacheWritePrice"],
  ["Output", "outputPrice"],
] as const;

function modelLabel(model: PaidModelPrice) {
  const name = model.name.replace(/\s*\((?:Direct|OpenRouter)\)\s*$/, "");
  const parts = name.split(" · ");
  return routed(model) && parts.length > 1
    ? { name: parts.slice(1).join(" · "), company: parts[0] }
    : { name: parts[0], company: parts.slice(1).join(" · ") || model.provider };
}

function Availability({ available }: { available: boolean }) {
  return <span className="model-price-status" data-available={available}><span aria-hidden="true" />{available ? "Available" : "Coming soon"}</span>;
}

/**
 * `offerPercent`, while a price offer runs: the prices given are already the offer prices, and
 * each one shows its regular price struck through.
 */
export function ModelPrices({ models, title = "Model pricing", offerPercent }: { models: PaidModelPrice[]; title?: string; offerPercent?: number | undefined }) {
  const rates = ALL_RATES.filter(([, key]) => key !== "cacheWritePrice" || models.some((model) => model.cacheWritePrice !== undefined));
  const showAvailability = models.some((model) => !model.available);
  const [query, setQuery] = useState("");
  const [connection, setConnection] = useState<"all" | "direct" | "openrouter">("all");
  const shown = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return models.filter(model => (connection === "all" || routed(model) === (connection === "openrouter")) && `${model.name} ${model.provider}`.toLocaleLowerCase().includes(search));
  }, [models, query, connection]);
  const direct = models.filter(model => !routed(model)).length;
  const filters = [
    { id: "all", label: "All models", count: models.length },
    { id: "direct", label: "Direct", count: direct },
    { id: "openrouter", label: "OpenRouter", count: models.length - direct },
  ] as const;

  return <section className="model-prices" aria-labelledby="model-prices-title">
    <div className="model-prices-heading">
      <div><h3 id="model-prices-title">{title}</h3><p>Compare models. Pay for what you use.</p></div>
      <div className="model-prices-units">{offerPercent !== undefined && <span className="model-prices-offer-flag">{offerPercent}% off</span>}<strong>USD / 1M tokens</strong><span>{offerPercent === undefined ? "The price you pay" : "Offer price you pay, regular price struck through"}</span></div>
    </div>
    <div className="model-prices-toolbar">
      <label className="model-prices-search">
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
        <input type="search" aria-label="Search paid models" placeholder="Search models or providers…" value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <div className="model-prices-filters" role="group" aria-label="Filter model connections">
        {filters.map(filter => <button type="button" key={filter.id} aria-pressed={connection === filter.id} onClick={() => setConnection(filter.id)}>{filter.label}<span>{filter.count}</span></button>)}
      </div>
    </div>
    <div className="model-prices-scroll" role="region" aria-label="Paid model prices" tabIndex={0}>
      <table className="model-prices-table">
        <caption className="model-prices-sr-only">Model prices in USD per one million tokens: the price you pay{offerPercent === undefined ? "" : `, ${offerPercent}% off the regular price`}.</caption>
        <thead><tr><th scope="col">Model</th><th scope="col">Connection</th>{rates.map(([label, key]) => <th scope="col" className="model-price-number" key={key}>{label}</th>)}{showAvailability && <th scope="col">Availability</th>}</tr></thead>
        <tbody>{shown.map(model => {
          const label = modelLabel(model);
          return <tr key={model.id}>
            <th scope="row" title={model.name}><strong>{label.name}</strong><span className="model-price-company">{label.company}</span></th>
            <td><span className="model-price-connection">{routed(model) ? "OpenRouter" : "Direct"}</span></td>
            {rates.map(([, key]) => <td className="model-price-number" data-rate={key} key={key}><Rate value={model[key] ?? model.inputPrice} offerPercent={offerPercent} /></td>)}
            {showAvailability && <td><Availability available={model.available} /></td>}
          </tr>;
        })}</tbody>
      </table>
    </div>
    <ul className="model-prices-cards" aria-label="Paid model prices">
      {shown.map(model => {
        const label = modelLabel(model);
        return <li className="model-price-card" key={model.id}>
          <div className="model-price-card-heading"><div><h4>{label.name}</h4><p>{label.company}<span aria-hidden="true"> · </span>{routed(model) ? "OpenRouter" : "Direct"}</p></div>{showAvailability && <Availability available={model.available} />}</div>
          <dl>{rates.map(([name, key]) => <div key={key}><dt>{name}</dt><dd><Rate value={model[key] ?? model.inputPrice} offerPercent={offerPercent} /></dd></div>)}</dl>
        </li>;
      })}
    </ul>
    {shown.length === 0 && <div className="model-prices-empty"><strong>No matching models</strong><p>Try another model name or provider.</p><button type="button" onClick={() => { setQuery(""); setConnection("all"); }}>Show all models</button></div>}
    <div className="model-prices-footer">
      <span role="status">{shown.length} of {models.length} connections</span>
      <details><summary>How pricing works</summary><p>These are the prices you pay.{offerPercent !== undefined && ` While the offer runs, each request is charged ${offerPercent}% less than the regular price shown struck through; the regular price applies again once it ends.`} Applicable tax is shown at checkout. Cache discounts apply when reported by the provider. GPT-6 Luna prompts above 272K tokens use twice the input and cache rates and 1.5 times the output rate. Direct DeepSeek prices follow its ordinary peak and off-peak schedule. Models marked Coming soon are not available to use yet.</p></details>
    </div>
  </section>;
}
