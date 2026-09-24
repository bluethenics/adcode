import { showcase } from "@/lib/showcase";
import { Mark } from "./Mark";

const code = [
  <><span className="syntax-purple">import</span> {'{ createApp }'} <span className="syntax-purple">from</span> <span className="syntax-green">'./app'</span>;</>,
  <></>,
  <span className="syntax-comment">// A little idea. A lot of possibility.</span>,
  <><span className="syntax-purple">const</span> app = <span className="syntax-blue">createApp</span>({'{'}</>,
  <>  name: <span className="syntax-green">'something-great'</span>,</>,
  <>  ready: <span className="syntax-purple">true</span>,</>,
  <>{'}'});</>,
  <></>,
  <><span className="syntax-purple">export default</span> <span className="syntax-blue">function</span> Start() {'{'}</>,
  <>  <span className="syntax-purple">return</span> app.<span className="syntax-blue">build</span>();</>,
  <>{'}'}</>,
];

export function AppShowcase() {
  const lightImage = showcase.light ?? showcase.dark;
  const darkImage = showcase.dark ?? showcase.light;
  // Use the taller ratio for both themes so switching appearance never moves the page.
  const frameRatio = lightImage && darkImage
    ? Math.min(lightImage.width / lightImage.height, darkImage.width / darkImage.height)
    : undefined;
  return <figure className="app-showcase" id="product">
    <div className="showcase-stage">
      {lightImage && darkImage ? <div className="showcase-images" style={{ aspectRatio: frameRatio }}>
        <img className="showcase-image-light" src={lightImage.src} alt={showcase.alt} width={lightImage.width} height={lightImage.height} fetchPriority="high" />
        <img className="showcase-image-dark" src={darkImage.src} alt={showcase.alt} width={darkImage.width} height={darkImage.height} fetchPriority="high" />
      </div> : <div className="editor-preview" aria-label="Illustrative ADCode workspace preview">
        <div className="editor-titlebar"><span className="window-dots" aria-hidden="true"><i /><i /><i /></span><span>ADCode <span className="editor-title-project">/ something-great</span></span><span className="preview-badge">Workspace preview</span></div>
        <div className="editor-workspace">
          <aside className="editor-explorer"><div className="editor-wordmark"><Mark size={26} /> Your next big idea</div><span className="editor-section-label">EXPLORER</span><span>⌄ &nbsp; something-great</span><span className="file-indent">⌄ &nbsp; src</span><span className="file-active"><b>TS</b> &nbsp; app.tsx</span><span className="file-indent">◇ &nbsp; styles.css</span><span>◇ &nbsp; package.json</span><div className="editor-branch">⑂ &nbsp; main <span>All changes saved</span></div></aside>
          <div className="editor-center"><div className="editor-file-tab"><b>TS</b> app.tsx <span>×</span></div><div className="editor-breadcrumb">src <span>›</span> app.tsx</div><div className="editor-code">{code.map((line, i) => <div key={i}><span className="line-number">{i + 1}</span><code>{line}</code></div>)}</div><div className="editor-terminal"><div>Terminal <span>bash</span></div><p><span className="syntax-green">❯</span> npm run dev</p><p className="syntax-comment">Your next chapter starts here.</p><p><span className="syntax-green">✓</span> Ready on localhost:3000</p></div></div>
          <aside className="editor-assistant"><div className="assistant-heading">✧ &nbsp; AI assistant <span>+</span></div><div className="assistant-prompt">Help me turn this idea into something real.</div><div className="assistant-response"><span className="assistant-avatar"><Mark size={22} /></span><p>Let’s build it together. I’ll start with the project structure, then we can make it yours.</p><div className="assistant-file">✓ &nbsp; app.tsx <span>+24</span></div><div className="assistant-file">✓ &nbsp; styles.css <span>+18</span></div><span className="assistant-complete">2 files updated</span></div><div className="assistant-composer">Ask anything about your code…<span>Agent <b>↑</b></span></div></aside>
        </div><div className="editor-statusbar"><span>⑂ main &nbsp; ✓ No problems</span><span>TypeScript &nbsp; UTF-8 &nbsp; ADCode</span></div>
      </div>}
    </div>
    <figcaption><span>Your editor. Your flow. Your share.</span><span>AI, terminal, and Git. Together in one workspace.</span></figcaption>
  </figure>;
}
