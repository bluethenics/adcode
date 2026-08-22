const files = ["src", "  app", "    routes.ts", "    ledger.ts", "  components", "package.json"];

/** A compact, static product preview for marketing pages. */
export function DesktopMockup({ className = "" }: { className?: string }) {
  return (
    <section className={`desktop-mockup ${className}`.trim()} aria-label="ADCode desktop workspace preview">
      <header className="desktop-mockup__titlebar">
        <span className="desktop-mockup__traffic" aria-hidden="true"><i /><i /><i /></span>
        <span className="desktop-mockup__workspace">adcode / revenue-ledger</span>
        <span className="desktop-mockup__status">● Connected</span>
      </header>

      <div className="desktop-mockup__shell">
        <aside className="desktop-mockup__sidebar" aria-label="Project files">
          <div className="desktop-mockup__brand"><span>&lt;$&gt;</span> ADCode</div>
          <p className="desktop-mockup__side-label">Explorer</p>
          <div className="desktop-mockup__files">
            {files.map((file) => <span key={file} className={file.includes("ledger") ? "is-active" : ""}>{file}</span>)}
          </div>
          <div className="desktop-mockup__agent"><b>Agent ready</b><span>Ask about this repo</span></div>
        </aside>

        <main className="desktop-mockup__main">
          <div className="desktop-mockup__tabs"><span className="is-open">ledger.ts <b>×</b></span><span>routes.ts</span></div>
          <div className="desktop-mockup__code" aria-label="TypeScript code">
            <div><em>12</em><span className="pink">export function</span> <span className="blue">credit</span>(</div>
            <div><em>13</em>&nbsp;&nbsp;entry: <span className="blue">LedgerEntry</span>,</div>
            <div><em>14</em>): <span className="blue">Balance</span> {'{'}</div>
            <div><em>15</em>&nbsp;&nbsp;<span className="pink">if</span> (entry.verified) {'{'}</div>
            <div><em>16</em>&nbsp;&nbsp;&nbsp;&nbsp;<span className="pink">return</span> addMicros(entry.value);</div>
            <div><em>17</em>&nbsp;&nbsp;{'}'}</div>
            <div><em>18</em>&nbsp;&nbsp;<span className="pink">return</span> pending(entry);</div>
            <div><em>19</em>{'}'}</div>
          </div>

          <aside className="desktop-mockup__sponsor">
            <span>Sponsored · FLY.IO</span>
            <b>Deploy close to your users.</b>
            <small>Run apps in 30 regions from one command.</small>
            <button type="button">View offer <span aria-hidden="true">↗</span></button>
          </aside>

          <section className="desktop-mockup__terminal" aria-label="Terminal">
            <span className="desktop-mockup__terminal-title">Terminal <i>bash</i></span>
            <p><b>~</b> <span>adcode ledger --watch</span></p>
            <p className="desktop-mockup__terminal-result">✓ verified impression · +$0.004200</p>
          </section>
        </main>

        <aside className="desktop-mockup__ledger" aria-label="Earnings ledger">
          <header><span>Live ledger</span><b>$0.012600</b></header>
          <p>Today, 3 verified events</p>
          <div className="desktop-mockup__ledger-entry"><span><b>Fly.io</b><small>Viewed · 4.2s</small></span><strong>+$0.004200</strong></div>
          <div className="desktop-mockup__ledger-entry"><span><b>Linear</b><small>Viewed · 5.1s</small></span><strong>+$0.004200</strong></div>
          <div className="desktop-mockup__ledger-entry"><span><b>Neon</b><small>Viewed · 3.8s</small></span><strong>+$0.004200</strong></div>
          <footer>Every event is itemized.</footer>
        </aside>
      </div>
    </section>
  );
}
