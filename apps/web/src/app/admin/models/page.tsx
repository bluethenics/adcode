"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { useAuth } from "@/components/AuthProvider";
import { apiFetch } from "@/lib/api";
import {
  EMPTY_MODEL_OVERRIDES,
  modelKey,
  toggleKey,
  usableProviders,
  type AddedModel,
  type ModelOverrides,
  type PanelModel,
  type PanelProvider,
} from "@/lib/modelCatalog";
import "@/components/adminModels.css";

/**
 * AI models: what the model picker in every editor offers.
 *
 * The list itself comes from models.dev, read here in the browser and cut the way the editor
 * cuts it. What this page edits is the small document of overrides every editor reads on
 * launch: the model each provider starts on, featured models, hidden ones (because they fail
 * for people), a line about a model, and models to add before models.dev lists them.
 */
export default function ModelsPage() {
  return (
    <AdminShell title="AI models" subtitle="What the model picker in every editor offers. Saved changes reach editors within about five minutes.">
      <ModelsEditor />
    </AdminShell>
  );
}

interface SavedCatalog {
  overrides: ModelOverrides;
  updatedAt: number;
  updatedBy: string;
}

/** How a model's turns ended for real people (GET /v1/admin/model-health). */
interface ModelHealth {
  provider: string;
  model: string;
  turns: number;
  ok: number;
  okAvgMs: number | null;
  outcomes: Record<string, number>;
}

/** Below this many turns a percentage says more about luck than about the model. */
const ENOUGH_TURNS = 10;

function worksLabel(health: ModelHealth | undefined): { text: string; tone: "good" | "warn" | "bad" | "none" } {
  if (health === undefined || health.turns === 0) return { text: "—", tone: "none" };
  const share = Math.round((health.ok / health.turns) * 100);
  const text = `${String(share)}% of ${String(health.turns)}`;
  if (health.turns < ENOUGH_TURNS) return { text, tone: "none" };
  return { text, tone: share >= 90 ? "good" : share >= 70 ? "warn" : "bad" };
}

/** The outcome a failing model fails with most, in words. */
function worstOutcome(health: ModelHealth): string {
  const words: Record<string, string> = {
    auth: "key refused", credits: "out of credit", rate_limit: "rate limited", too_large: "request too large",
    model_missing: "model unavailable", no_tools: "cannot use tools", tool_format: "broken tool calls", network: "network",
    server: "provider errors", output_limit: "output limit", thinking_limit: "thinks without answering", history: "history refused",
    refused: "declined", other: "other errors",
  };
  const [outcome] = Object.entries(health.outcomes)
    .filter(([name]) => name !== "ok" && name !== "cancelled")
    .sort((a, b) => b[1] - a[1])[0] ?? [];
  return outcome === undefined ? "" : (words[outcome] ?? outcome);
}

/** Rows shown per provider before "Show all": OpenRouter alone lists over three hundred. */
const PAGE = 30;
const NEW_FOR_DAYS = 30;

const tokens = (value: number | null): string =>
  value === null ? "—" : value >= 1_000_000 ? `${String(Math.round(value / 100_000) / 10)}M` : `${String(Math.round(value / 1000))}K`;
const dollars = (value: number | null): string => (value === null ? "—" : `$${value < 1 ? value.toFixed(2) : String(Math.round(value * 100) / 100)}`);

function fromAdded(added: AddedModel): PanelModel {
  return {
    id: added.id,
    name: added.name,
    releaseDate: added.releaseDate ?? null,
    contextWindow: added.contextWindow ?? null,
    maxOutput: added.maxOutput ?? null,
    inputPrice: added.inputPrice ?? null,
    outputPrice: added.outputPrice ?? null,
    reasoning: added.reasoning === true,
    effortLevels: added.effortLevels ?? [],
  };
}

function ModelsEditor() {
  const { token } = useAuth();
  const [providers, setProviders] = useState<PanelProvider[] | null>(null);
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [saved, setSaved] = useState<SavedCatalog | null>(null);
  const [draft, setDraft] = useState<ModelOverrides>(EMPTY_MODEL_OVERRIDES);
  const [loadFailed, setLoadFailed] = useState(false);
  const [providerFilter, setProviderFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [onlyNew, setOnlyNew] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [health, setHealth] = useState<Map<string, ModelHealth>>(new Map());

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await apiFetch<{ models: ModelHealth[] }>({ path: "/admin/model-health?days=7", token: await token() });
        if (active && result.ok) setHealth(new Map(result.value.models.map((one) => [modelKey(one.provider, one.model), one])));
      } catch {
        // The column stays empty; the list still works.
      }
    })();
    void (async () => {
      try {
        const result = await apiFetch<SavedCatalog>({ path: "/admin/models", token: await token() });
        if (!active) return;
        if (result.ok) {
          setSaved(result.value);
          setDraft(result.value.overrides);
        } else setLoadFailed(true);
      } catch {
        if (active) setLoadFailed(true);
      }
    })();
    void fetch("https://models.dev/api.json")
      .then((response) => response.json())
      .then((raw: unknown) => { if (active) setProviders(usableProviders(raw)); })
      .catch(() => { if (active) setCatalogFailed(true); });
    return () => { active = false; };
  }, [token]);

  const dirty = saved !== null && JSON.stringify(draft) !== JSON.stringify(saved.overrides);
  const newSince = useMemo(() => new Date(Date.now() - NEW_FOR_DAYS * 86_400_000).toISOString().slice(0, 10), []);

  const visible = useMemo(() => {
    if (providers === null) return [];
    const needle = query.trim().toLowerCase();
    return providers
      .filter((provider) => providerFilter === "all" || provider.id === providerFilter)
      .map((provider) => {
        const added = draft.added.filter((one) => one.provider === provider.id && !provider.models.some((model) => model.id === one.id)).map(fromAdded);
        const models = [...added, ...provider.models].filter((model) =>
          (needle.length === 0 || model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle)) &&
          (!onlyNew || (model.releaseDate !== null && model.releaseDate >= newSince)),
        );
        return { provider, models, addedIds: new Set(added.map((one) => one.id)) };
      })
      .filter((entry) => entry.models.length > 0);
  }, [providers, providerFilter, query, onlyNew, draft.added, newSince]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await apiFetch<SavedCatalog>({ path: "/admin/models", method: "POST", body: draft, token: await token() });
      if (result.ok) {
        setSaved(result.value);
        setDraft(result.value.overrides);
        setNotice({ tone: "ok", text: "Saved. Editors pick this up the next time they start, within about five minutes." });
      } else setNotice({ tone: "error", text: "The server refused that. Check the added models' fields and try again." });
    } catch {
      setNotice({ tone: "error", text: "Could not reach the server. Nothing was saved." });
    } finally {
      setBusy(false);
    }
  };

  const setRecommended = (provider: string, model: string): void =>
    setDraft((current) => ({ ...current, recommended: { ...current.recommended, [provider]: model } }));
  const clearRecommended = (provider: string): void =>
    setDraft((current) => {
      const next = { ...current.recommended };
      delete next[provider];
      return { ...current, recommended: next };
    });
  const setNote = (key: string, value: string): void =>
    setDraft((current) => {
      const notes = { ...current.notes };
      if (value.trim().length === 0) delete notes[key];
      else notes[key] = value.slice(0, 140);
      return { ...current, notes };
    });

  if (loadFailed) return <div className="notice" data-tone="error" role="alert">Could not load the saved model list. Reload to try again.</div>;
  if (saved === null) return <p className="lede">Loading…</p>;

  return (
    <div className="admin-models">
      {notice !== null && <div className="notice" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</div>}

      <div className="admin-toolbar admin-models-toolbar">
        <div className="admin-filters">
          <select className="select" value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)} aria-label="Provider">
            <option value="all">All providers</option>
            {(providers ?? []).map((provider) => <option key={provider.id} value={provider.id}>{provider.name}</option>)}
          </select>
          <input className="input admin-toolbar-search" type="search" placeholder="Search models" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search models" />
          <label className="admin-models-check"><input type="checkbox" checked={onlyNew} onChange={(event) => setOnlyNew(event.target.checked)} /> New in the last {NEW_FOR_DAYS} days</label>
        </div>
        <div className="admin-models-actions">
          <button type="button" className="btn" disabled={!dirty || busy} onClick={() => setDraft(saved.overrides)}>Discard changes</button>
          <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>

      <p className="admin-models-meta">
        {saved.updatedAt > 0 ? `Last saved ${new Date(saved.updatedAt).toLocaleString()} by ${saved.updatedBy}.` : "Nothing saved yet - editors use their built-in recommendations."}
        {" "}{draft.hidden.length} hidden · {draft.featured.length} featured · {Object.keys(draft.recommended).length} start-here choices · {draft.added.length} added
      </p>

      <FailingModels health={[...health.values()]} hidden={draft.hidden} onHide={(key) => setDraft((current) => ({ ...current, hidden: toggleKey(current.hidden, key) }))} />

      {catalogFailed && <div className="notice" data-tone="error" role="alert">models.dev did not answer, so the list cannot be shown. Your saved choices are untouched.</div>}
      {providers === null && !catalogFailed && <p className="lede">Reading models.dev…</p>}

      {visible.map(({ provider, models, addedIds }) => {
        const all = expanded[provider.id] === true;
        const shown = all ? models : models.slice(0, PAGE);
        const start = draft.recommended[provider.id];
        return (
          <section className="admin-models-provider" key={provider.id}>
            <header className="admin-card-head">
              <div>
                <h3>{provider.name}</h3>
                <p className="row-sub">{models.length} model{models.length === 1 ? "" : "s"} · starts on {start ?? "its built-in recommendation"}</p>
              </div>
              {start !== undefined && <button type="button" className="btn" onClick={() => clearRecommended(provider.id)}>Use the built-in choice</button>}
            </header>
            <div className="admin-models-scroll">
              <table className="admin-models-table">
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col">Released</th>
                    <th scope="col">Context</th>
                    <th scope="col">Price in / out (1M)</th>
                    <th scope="col" title="Turns that ended with an answer, last 7 days">Works</th>
                    <th scope="col">Starts here</th>
                    <th scope="col">Featured</th>
                    <th scope="col">Hidden</th>
                    <th scope="col">Note shown to people</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((model) => {
                    const key = modelKey(provider.id, model.id);
                    const hidden = draft.hidden.includes(key);
                    return (
                      <tr key={key} data-hidden={hidden ? "true" : undefined}>
                        <td>
                          <span className="admin-models-name">{model.name}</span>
                          <span className="admin-models-id">{model.id}</span>
                          {addedIds.has(model.id) && (
                            <span className="admin-models-added">
                              Added here · <button type="button" className="admin-models-link" onClick={() => setDraft((current) => ({ ...current, added: current.added.filter((one) => !(one.provider === provider.id && one.id === model.id)) }))}>Remove</button>
                            </span>
                          )}
                        </td>
                        <td>{model.releaseDate ?? "—"}</td>
                        <td>{tokens(model.contextWindow)}</td>
                        <td>{dollars(model.inputPrice)} / {dollars(model.outputPrice)}</td>
                        <td>{(() => {
                          const works = worksLabel(health.get(key));
                          return <span className="admin-models-works" data-tone={works.tone}>{works.text}</span>;
                        })()}</td>
                        <td><input type="radio" name={`start-${provider.id}`} checked={start === model.id} onChange={() => setRecommended(provider.id, model.id)} aria-label={`Start ${provider.name} on ${model.name}`} /></td>
                        <td><input type="checkbox" checked={draft.featured.includes(key)} onChange={() => setDraft((current) => ({ ...current, featured: toggleKey(current.featured, key) }))} aria-label={`Feature ${model.name}`} /></td>
                        <td><input type="checkbox" checked={hidden} onChange={() => setDraft((current) => ({ ...current, hidden: toggleKey(current.hidden, key) }))} aria-label={`Hide ${model.name}`} /></td>
                        <td><input className="input admin-models-note" type="text" maxLength={140} value={draft.notes[key] ?? ""} placeholder="e.g. Best for big builds" onChange={(event) => setNote(key, event.target.value)} aria-label={`Note for ${model.name}`} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {models.length > PAGE && (
              <button type="button" className="btn admin-models-more" onClick={() => setExpanded((current) => ({ ...current, [provider.id]: !all }))}>
                {all ? "Show fewer" : `Show all ${String(models.length)}`}
              </button>
            )}
          </section>
        );
      })}

      <AddModel providers={providers ?? []} onAdd={(added) => setDraft((current) => ({ ...current, added: [...current.added.filter((one) => !(one.provider === added.provider && one.id === added.id)), added] }))} />
    </div>
  );
}

/** Models that fail for people most often, with a one-click hide - the evidence first. */
function FailingModels({ health, hidden, onHide }: { health: ModelHealth[]; hidden: string[]; onHide: (key: string) => void }) {
  const failing = health
    .filter((one) => one.turns >= ENOUGH_TURNS && one.ok / one.turns < 0.7)
    .sort((a, b) => a.ok / a.turns - b.ok / b.turns)
    .slice(0, 8);
  if (health.length === 0) {
    return <p className="admin-models-meta">How each model does for people appears here once editors on this version report finished turns.</p>;
  }
  if (failing.length === 0) {
    return <p className="admin-models-meta">No model with {ENOUGH_TURNS} or more turns in the last 7 days worked less than 70% of the time.</p>;
  }
  return (
    <section className="admin-models-failing">
      <h3>Failing for people, last 7 days</h3>
      <ul>
        {failing.map((one) => {
          const key = modelKey(one.provider, one.model);
          const isHidden = hidden.includes(key);
          return (
            <li key={key}>
              <span className="admin-models-id">{key}</span>
              <span>{String(Math.round((one.ok / one.turns) * 100))}% of {String(one.turns)} worked · mostly {worstOutcome(one)}</span>
              <button type="button" className="btn" onClick={() => onHide(key)}>{isHidden ? "Unhide" : "Hide"}</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A model models.dev does not list yet - a launch from this morning. */
function AddModel({ providers, onAdd }: { providers: PanelProvider[]; onAdd: (added: AddedModel) => void }) {
  const [provider, setProvider] = useState("openai");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [context, setContext] = useState("");
  const [output, setOutput] = useState("");
  const [inputPrice, setInputPrice] = useState("");
  const [outputPrice, setOutputPrice] = useState("");
  const [reasoning, setReasoning] = useState(false);
  const [levels, setLevels] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const add = (): void => {
    const number = (raw: string): number | undefined => (raw.trim() === "" ? undefined : Number(raw));
    const contextWindow = number(context);
    const maxOutput = number(output);
    const input = number(inputPrice);
    const outputCost = number(outputPrice);
    if (!/^[^\s:]{1,200}$/.test(id.trim()) || id.trim().length === 0) return setProblem("Enter the model id exactly as the provider spells it, with no spaces.");
    for (const value of [contextWindow, maxOutput]) {
      if (value !== undefined && !(Number.isSafeInteger(value) && value > 0)) return setProblem("Context and output are whole numbers of tokens, like 1000000.");
    }
    for (const value of [input, outputCost]) {
      if (value !== undefined && !(Number.isFinite(value) && value >= 0)) return setProblem("Prices are US dollars per million tokens, like 2.5.");
    }
    const effortLevels = levels.split(",").map((one) => one.trim().toLowerCase()).filter((one) => /^[a-z]{1,12}$/.test(one));
    onAdd({
      provider,
      id: id.trim(),
      name: name.trim() || id.trim(),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxOutput === undefined ? {} : { maxOutput }),
      ...(reasoning ? { reasoning: true } : {}),
      ...(effortLevels.length === 0 ? {} : { effortLevels }),
      ...(input === undefined ? {} : { inputPrice: input }),
      ...(outputCost === undefined ? {} : { outputPrice: outputCost }),
      releaseDate: new Date().toISOString().slice(0, 10),
    });
    setProblem(null);
    setId("");
    setName("");
  };

  return (
    <details className="admin-models-add">
      <summary>Add a model models.dev does not list yet</summary>
      <p className="row-sub">It appears at the top of its provider in every editor, tagged New, until models.dev catches up - then the panel stops adding it twice.</p>
      <div className="admin-models-form">
        <div className="field"><span>Provider</span>
          <select className="select" value={provider} onChange={(event) => setProvider(event.target.value)}>
            {(providers.length > 0 ? providers.map((one) => one.id) : ["openai"]).map((one) => <option key={one} value={one}>{one}</option>)}
          </select>
        </div>
        <div className="field"><span>Model id</span><input className="input" value={id} onChange={(event) => setId(event.target.value)} placeholder="gpt-7" /></div>
        <div className="field"><span>Display name</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="GPT-7" /></div>
        <div className="field"><span>Context (tokens)</span><input className="input" inputMode="numeric" value={context} onChange={(event) => setContext(event.target.value)} placeholder="1000000" /></div>
        <div className="field"><span>Max output (tokens)</span><input className="input" inputMode="numeric" value={output} onChange={(event) => setOutput(event.target.value)} placeholder="128000" /></div>
        <div className="field"><span>Input $ / 1M</span><input className="input" inputMode="decimal" value={inputPrice} onChange={(event) => setInputPrice(event.target.value)} placeholder="2" /></div>
        <div className="field"><span>Output $ / 1M</span><input className="input" inputMode="decimal" value={outputPrice} onChange={(event) => setOutputPrice(event.target.value)} placeholder="10" /></div>
        <div className="field"><span>Effort levels</span><input className="input" value={levels} onChange={(event) => setLevels(event.target.value)} placeholder="low, medium, high" /></div>
        <label className="admin-models-check"><input type="checkbox" checked={reasoning} onChange={(event) => setReasoning(event.target.checked)} /> Reasons before answering</label>
      </div>
      {problem !== null && <div className="notice" data-tone="error" role="alert">{problem}</div>}
      <button type="button" className="btn btn-primary" onClick={add}>Add to the list</button>
      <p className="row-sub">Then press Save at the top.</p>
    </details>
  );
}
