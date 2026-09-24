import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Real renderer + IPC + provider checks, using only a local fake inference endpoint. */
export async function checkAi({ evaluate, send, waitFor, sleep, artifacts }) {
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    requests.push(request);
    res.writeHead(200, { "content-type": "text/event-stream" });
    const lastUser = request.messages.findLast(message => message.role === 'user');
    if (lastUser?.content === 'chat-preview-smoke') {
      const afterRequest = request.messages.slice(request.messages.lastIndexOf(lastUser) + 1);
      const delta = afterRequest.some(message => message.role === 'tool')
        ? { content: 'Your saved app is running in the live preview below.' }
        : { tool_calls: [{ index: 0, id: 'preview-fixture', function: { name: 'open_preview', arguments: '{}' } }] };
      res.end('data: ' + JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] }) + '\n\ndata: [DONE]\n\n');
      return;
    }
    if (lastUser?.content === 'workspace-review-smoke') {
      const afterRequest = request.messages.slice(request.messages.lastIndexOf(lastUser) + 1);
      if (!afterRequest.some(message => message.role === 'tool')) {
        const tool_calls = ['styles.css', 'review-note.txt'].map((path, index) => ({ index, id: `review-fixture-${index}`, function: {
          name: 'propose_edit', arguments: JSON.stringify({ path, contents: `/* reviewed-mode-change ${index} */\n`, summary: `Update ${path} for review smoke` }),
        } }));
        res.end('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls }, finish_reason: 'tool_calls' }] }) + '\n\ndata: [DONE]\n\n');
      } else res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Two changes are ready for review.' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
      return;
    }
    if (request.messages.some(message => message.role === 'user' && typeof message.content === 'string' && message.content.includes('stream-batch-smoke'))) {
      for (let index = 0; index < 100; index++) {
        res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: `chunk-${index} ` }, finish_reason: null }] }) + '\n\n');
        if (request.messages.at(-1)?.content?.includes('switch-modes')) await new Promise(resolve => setTimeout(resolve, 20));
      }
      res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
      return;
    }
    if (request.tools?.length && !request.messages.some(message => message.role === 'tool')) {
      res.end('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"read-fixture","function":{"name":"read_file","arguments":"{\\"path\\":\\"layout.html\\"}"}}]},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n');
      return;
    }
    res.end('data: {"choices":[{"delta":{"content":"Local connection works."},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  async function clickText(selector, text) {
    await evaluate(`(() => {
      const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find(el => el.getClientRects().length && el.textContent.trim() === ${JSON.stringify(text)});
      if (!button) throw new Error('Missing button: ' + ${JSON.stringify(text)});
      button.click();
    })()`);
    await sleep(150);
  }
  async function field(label, value) {
    await evaluate(`(() => {
      const el = [...document.querySelectorAll('[aria-label=' + JSON.stringify(${JSON.stringify(label)}) + ']')].find(el => el.getClientRects().length);
      if (!el) throw new Error('Missing field: ' + ${JSON.stringify(label)});
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('input', {bubbles:true}));
      el.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
  }
  async function screenshot(name) {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(artifacts, name + '.png'), Buffer.from(shot.data, 'base64'));
  }
  async function openAssistant() {
    await evaluate("document.querySelector('.project-tools').click()");
    await clickText('.menu-item', 'AI assistant');
  }
  try {
    await evaluate("window.adcode.settings.write('adcode.appearance.theme', 'light')");
    if (await evaluate("document.getElementById('assistant-dock').hidden")) await openAssistant();
    await evaluate("document.querySelector('[aria-label=\"Expand assistant workspace\"]').click()");
    await waitFor("document.querySelector('dialog[data-popup-id=chat]').open");
    await clickText('.chat-header button', 'Connect');
    await waitFor("document.querySelector('dialog[open] .connect-row') !== null");
    await clickText('dialog[open] .connect-panel button', '+ Add connection');
    await clickText('dialog[open] .connect-profile-form button', 'Use NVIDIA NIM preset');
    assert.equal(await evaluate("document.querySelector('[aria-label=\"API base URL\"]').value"), 'https://integrate.api.nvidia.com/v1');
    await field('Connection name', 'Local smoke model');
    await field('API base URL', endpoint);
    await field('Model ID', 'smoke-model');
    await field('Requests per minute', '120');
    await clickText('dialog[open] .connect-profile-form button', 'Save connection');
    await waitFor("document.querySelector('dialog[open] .connect-detail').textContent.includes('120 requests/minute')");
    const connection = await evaluate("(async () => (await window.adcode.ai.status()).connections.find(c => c.name === 'Local smoke model'))()");
    assert.ok(connection?.id, 'Named connection persists through IPC');
    await field('Local smoke model key', 'local-smoke-key');
    await clickText('dialog[open] .connect-detail button', 'Check and save');
    await waitFor(`document.querySelector('dialog[open] .connect-row[data-selected="true"]')?.textContent.includes('In use')`);
    const active = await evaluate("window.adcode.ai.status()");
    assert.equal(active.ready, true, 'Saving a checked key makes the assistant ready');
    assert.equal(active.activeProvider, connection.id, 'Saving a checked key activates its connection');
    assert.equal(active.activeModel, 'smoke-model', 'The assistant uses the saved connection model');
    await evaluate("window.adcode.settings.write('adcode.ai.provider', 'anthropic')");
    await sleep(1100);
    await evaluate(`(() => {
      const row = [...document.querySelectorAll('dialog[open] .connect-row')].find(el => el.getClientRects().length && el.textContent.includes('Local smoke model'));
      if (!row) throw new Error('Saved connection is not visible');
      row.click();
    })()`);
    await clickText('dialog[open] .connect-selection button', 'Use this model');
    await waitFor(`(async () => (await window.adcode.ai.status()).activeProvider === ${JSON.stringify(connection.id)})()`);
    await waitFor(`document.querySelector('dialog[open] .connect-row[data-selected="true"]')?.textContent.includes('In use')`);
    assert.equal((await evaluate("window.adcode.ai.status()")).activeProvider, connection.id,
      'A previously saved connection can be activated without entering its key again');
    assert.equal(requests[0]?.model, 'smoke-model', 'Key check uses the connection model, not another active model');
    await screenshot('ai-connect');
    await clickText('dialog[open] .connect-panel button', 'Close');
    if (!await evaluate("document.querySelector('.chat-card').dataset.inspectorOpen === 'true'")) {
      await clickText('.chat-header button', 'Inspector');
    }
    await waitFor("document.querySelector('.ai-agent-library')?.getClientRects().length > 0");
    for (const name of ['Builder', 'Reviewer']) {
      await clickText('.ai-agent-library button', 'New agent');
      await waitFor("document.querySelector('.ai-agent-form').hidden === false");
      await evaluate(`(() => {
        const form = document.querySelector('.ai-agent-form');
        const labels = [...form.querySelectorAll('label')];
        const set = (name, value) => { const el = labels.find(label => label.querySelector('span')?.textContent === name).querySelector('input,textarea,select'); el.value = value; el.dispatchEvent(new Event('change', {bubbles:true})); };
        set('Name', ${JSON.stringify(name)});
        set('Instructions', ${JSON.stringify(name === 'Builder' ? 'Implement the requested task and report results.' : 'Review the implementation and report correctness findings.')});
        set('Connection', ${JSON.stringify(connection.id)});
        set('Model ID', 'smoke-model');
        if (${JSON.stringify(name)} === 'Reviewer') form.querySelector('.ai-agent-order input').checked = true;
      })()`);
      await clickText('.ai-agent-form button', 'Save agent');
      await waitFor(`document.querySelector('.ai-agent-list').textContent.includes(${JSON.stringify(name)})`);
    }
    const profiles = await evaluate("(async () => JSON.parse((await window.adcode.settings.read())['adcode.ai.agentProfiles']))()");
    assert.equal(profiles.length, 2);
    assert.ok(profiles.every(p => p.provider === connection.id && p.model === 'smoke-model'));
    await evaluate("document.querySelector('.chat-input').value = 'Inspect this project and report a concise implementation plan.'; document.querySelectorAll('.ai-agent-profile input[type=checkbox]').forEach(el => el.click())");
    await clickText('.ai-agent-library button', 'Set up selected Team');
    await waitFor("document.querySelectorAll('.ai-team-role').length === 2");
    const teams = await evaluate("window.adcode.aiTeam.list()");
    assert.equal(teams[0].roles.length, 2);
    assert.equal(teams[0].roles[0].label, 'Builder');
    assert.deepEqual(teams[0].nodes[1].dependsOn, [teams[0].nodes[0].id]);
    await clickText('.ai-team-panel button', 'Start Team');
    await waitFor("document.querySelectorAll('.ai-team-role[data-state=completed]').length === 2", 300);
    await waitFor("document.querySelector('.ai-team-panel').dataset.state === 'completed'", 300);
    const traces = await evaluate(`window.adcode.aiTeam.traces(${JSON.stringify(teams[0].id)})`);
    assert.ok(traces.some(event => event.kind === 'tool-call' && event.roleId === profiles[0].id && event.summary.includes('read_file')), 'Builder tool activity reaches the public trace');
    assert.ok(traces.some(event => event.kind === 'tool-result' && event.roleId === profiles[1].id && event.summary.includes('read_file')), 'Reviewer tool result reaches its own public trace');
    assert.ok(requests.some(request => request.messages.some(message => message.role === 'system' && message.content.includes('Role: Reviewer')) && request.messages.some(message => message.role === 'user' && message.content.includes('Local connection works.'))), 'Reviewer receives the Builder handoff');
    await evaluate("document.querySelector('[aria-label=\"View Builder trace\"]').click()");
    await waitFor("document.querySelector('.chat-transcript').textContent.includes('Builder · Called read_file')");
    await sleep(300);
    await screenshot('ai-team-light');
    await evaluate("window.adcode.settings.write('adcode.appearance.theme', 'dark')");
    await sleep(200);
    await screenshot('ai-team-dark');
    for (const width of [900, 640]) {
      await send('Emulation.setDeviceMetricsOverride', {width, height:800, deviceScaleFactor:1, mobile:false});
      await sleep(200);
      if (width === 640) assert.equal(await evaluate("document.querySelector('.chat-card').dataset.historyOpen"), 'false', 'Narrow chat shows only one side panel');
      assert.equal(await evaluate(`(() => {
        const surface = document.querySelector('dialog[data-popup-id=chat] .popup-shell-surface').getBoundingClientRect();
        const composer = document.querySelector('.chat-composer').getBoundingClientRect();
        return composer.width > 0 && composer.right <= surface.right + 1 && composer.bottom <= surface.bottom + 1 && surface.right <= innerWidth + 1;
      })()`), true, `Composer remains within the ${width}px workspace`);
      await screenshot('ai-team-' + width);
    }
    assert.equal(await evaluate(`(() => {
      const buttons = [...document.querySelectorAll('.ai-agent-profile button')].filter(button => button.textContent === 'Delete');
      buttons[0].click();
      const protectedDuringSave = [...document.querySelectorAll('.ai-agent-library button')].every(button => button.disabled);
      buttons[1].click();
      return protectedDuringSave;
    })()`), true, 'Agent changes lock navigation and other mutations until persistence finishes');
    await waitFor("document.querySelectorAll('.ai-agent-profile').length === 1");
    const remaining = await evaluate("(async () => JSON.parse((await window.adcode.settings.read())['adcode.ai.agentProfiles']))()");
    assert.equal(remaining[0].name, 'Reviewer', 'A second overlapping delete cannot restore the first agent');
    // Exercise the built-in chat renderer with a burst of real provider/IPC deltas.
    // Instrument DOM replacements, not elapsed time, so this is stable on slow CI.
    await evaluate(`(() => {
      window.__streamReplacements = 0;
      window.__streamObserver = new MutationObserver(records => {
        for (const record of records) if (record.target instanceof HTMLElement && record.target.classList.contains('chat-bubble-assistant')) window.__streamReplacements++;
      });
      window.__streamObserver.observe(document.querySelector('.chat-transcript'), { subtree: true, childList: true });
    })()`);
    await evaluate("window.adcode.ai.send('stream-batch-smoke')");
    const expected = Array.from({ length: 100 }, (_, index) => `chunk-${index}`).join(' ');
    await waitFor(`document.querySelector('.chat-transcript').textContent.includes(${JSON.stringify(expected)})`);
    const paints = await evaluate('window.__streamReplacements');
    assert.ok(paints < 100, `100 text deltas coalesce into fewer DOM replacements (observed ${paints})`);
    await evaluate('window.__streamObserver.disconnect()');
    // Closed chat must also flush its last chunk; animation frames are optional.
    await clickText('.chat-header button', 'Close');
    await waitFor("!document.querySelector('dialog[data-popup-id=chat]').open");
    await waitFor("document.activeElement === document.querySelector('.project-tools')");
    await evaluate("window.adcode.ai.send('stream-batch-smoke while closed')");
    await openAssistant();
    await waitFor("document.querySelector('dialog[data-popup-id=chat]').open");
    await clickText('.chat-header button', 'Dock');
    await waitFor("document.querySelector('#assistant-dock .chat-card') !== null");
    assert.equal(await evaluate("document.querySelector('.chat-body .chat-history') !== null"), true, 'Conversation history remains available inside the shared assistant');
    await evaluate("document.querySelector('.chat-more-actions summary').click()");
    await clickText('.chat-more-menu button', 'History');
    await waitFor("document.querySelector('.chat-history').getClientRects().length > 0 && document.querySelectorAll('.chat-history-open').length > 0");
    await screenshot('saved-history-on-demand');
    await evaluate("document.querySelector('.chat-more-actions summary').click()");
    await clickText('.chat-more-menu button', 'History');
    await evaluate("document.querySelector('[aria-label=\"Expand assistant workspace\"]').click()");
    await waitFor(`document.querySelector('.chat-bubble-assistant:last-of-type')?.textContent.trim() === ${JSON.stringify(expected)} || [...document.querySelectorAll('.chat-bubble-assistant')].at(-1)?.textContent.trim() === ${JSON.stringify(expected)}`);
    await clickText('.chat-header button', 'Tools & skills');
    await waitFor("document.querySelector('.assistant-controls-content').textContent.includes('Choose which tools')");
    await clickText('.assistant-controls button', 'Skills');
    const installed = await evaluate('window.adcode.ai.controls()');
    assert.ok(Array.isArray(installed.skills));
    assert.ok(installed.skills.every(skill => ['workspace', 'system'].includes(skill.scope)));
    await screenshot('installed-skills');
    await clickText('.chat-header button', 'Dock');
    await waitFor("document.querySelector('#assistant-dock .chat-card') !== null && !document.querySelector('dialog[data-popup-id=chat]').open");
    await clickText('.chat-inspector button', 'Back to chat');
    await send('Emulation.setDeviceMetricsOverride', {width:1440, height:900, deviceScaleFactor:1, mobile:false});
    await sleep(250);
    assert.equal(await evaluate(`(() => {
      const editor = document.querySelector('.main').getBoundingClientRect();
      const dock = document.querySelector('#assistant-dock').getBoundingClientRect();
      return editor.width >= 360 && dock.width >= 340 && editor.right <= dock.left && document.querySelectorAll('.chat-card').length === 1 && document.querySelectorAll('.chat-history').length === 1 && parseFloat(getComputedStyle(document.querySelector('#assistant-dock')).borderLeftWidth) > 0;
    })()`), true, 'Docked editor and assistant have distinct bordered regions and retain one live conversation');
    assert.ok(await evaluate(`document.querySelector('#assistant-dock .chat-transcript').textContent.includes(${JSON.stringify(expected)})`), 'Docking retains the completed answer');
    await evaluate("document.querySelector('.chat-more-actions summary').click()");
    await clickText('.chat-more-menu button', 'Tools & skills');
    await waitFor("document.querySelector('.assistant-controls').getClientRects().length > 0");
    await clickText('.chat-inspector button', 'Back to chat');
    await evaluate("document.querySelector('[aria-label=\"Close Assistant\"]').click()");
    await waitFor("document.getElementById('assistant-dock').hidden");
    await openAssistant();
    await waitFor("!document.getElementById('assistant-dock').hidden");
    await evaluate("document.getElementById('terminal-new').click()");
    await waitFor("!document.getElementById('panel').hidden");
    await screenshot('agent-workbench');
    await send('Emulation.setDeviceMetricsOverride', {width:640, height:700, deviceScaleFactor:1, mobile:false});
    await sleep(250);
    if (await evaluate("document.getElementById('assistant-dock').hidden")) await openAssistant();
    assert.equal(await evaluate(`(() => {
      const dock = document.querySelector('#assistant-dock').getBoundingClientRect();
      const composer = document.querySelector('.chat-composer').getBoundingClientRect();
      return dock.right <= innerWidth && composer.left >= dock.left && composer.right <= dock.right && composer.bottom <= dock.bottom;
    })()`), true, 'Dock and composer stay reachable in narrow windows');
    await screenshot('agent-workbench-narrow');
    await send('Emulation.setDeviceMetricsOverride', {width:1440, height:900, deviceScaleFactor:1, mobile:false});
    await evaluate(`(() => {
      window.__liveModeChat = document.querySelector('.chat-card');
      window.__liveModeTurn = window.adcode.ai.send('stream-batch-smoke switch-modes');
    })()`);
    await sleep(200);
    await evaluate("document.querySelector('.workspace-mode-switch [data-mode=vibe]').click()");
    await sleep(250);
    await evaluate("document.querySelector('.workspace-mode-switch [data-mode=code]').click()");
    await sleep(200);
    await evaluate("document.querySelector('.workspace-mode-switch [data-mode=vibe]').click()");
    assert.equal(await evaluate("window.__liveModeTurn"), true, "Provider turn completes across multiple mode switches");
    assert.equal(await evaluate("document.querySelector('.chat-card') === window.__liveModeChat"), true);
    await waitFor(`[...document.querySelectorAll('.chat-bubble-assistant')].at(-1)?.textContent.trim() === ${JSON.stringify(expected)}`);
    await screenshot('vibe-live-session');
    await evaluate("(() => { if (!document.querySelector('.project-context')?.getClientRects().length) document.querySelector('.project-toolbar-action[title=\"Project, changes and saved tasks\"]')?.click(); })()");
    await evaluate("document.querySelector('#context-tab-tasks').click()");
    await waitFor("document.querySelectorAll('.context-task').length > 0");
    await evaluate("document.querySelector('.context-task summary').click()");
    await waitFor("document.querySelector('.context-task[open] .context-action') !== null");
    await evaluate("document.querySelector('.context-task[open] .context-action').click()");
    await waitFor("document.querySelector('.task-review-summary') !== null");
    await screenshot('vibe-task-review');
    const root = await evaluate("window.adcode.workspace.current().then(workspace => workspace.root)");
    const original = await evaluate(`window.adcode.files.read(${JSON.stringify(root + '/styles.css')}).then(file => file.text)`);
    await evaluate("window.adcode.ai.reset()");
    assert.equal(await evaluate("window.adcode.ai.send('workspace-review-smoke')"), true);
    assert.equal(await evaluate(`window.adcode.files.read(${JSON.stringify(root + '/styles.css')}).then(file => file.text)`), original, 'Proposals do not change project files before review');
    await evaluate("document.querySelector('#context-tab-changes').click()");
    await waitFor("document.querySelector('.context-content').textContent.includes('workspace-review-smoke')");
    await clickText('.context-content .context-action > span', 'workspace-review-smoke');
    const proposal = await evaluate("(async () => { const task = (await window.adcode.aiWorkspace.list()).find(task => task.prompt === 'workspace-review-smoke'); return window.adcode.aiWorkspace.changes(task.id); })()");
    assert.equal(proposal.length, 2, 'Both actual tool proposals are available for review');
    const additions = proposal.reduce((sum, file) => sum + file.hunks.reduce((total, hunk) => total + hunk.replacement.length, 0), 0);
    await waitFor(`[...document.querySelectorAll('.task-review-summary')].some(node => node.textContent.includes('workspace-review-smoke') && node.textContent.includes('+${additions}'))`);
    await screenshot('vibe-proposed-changes');
    await clickText('.task-review-summary button', 'Apply all changes');
    await waitFor(`(async () => (await window.adcode.files.read(${JSON.stringify(root + '/styles.css')})).text.includes('reviewed-mode-change'))()`);
    assert.match(await evaluate(`window.adcode.files.read(${JSON.stringify(root + '/review-note.txt')}).then(file => file.text)`), /reviewed-mode-change/);
    await evaluate("document.querySelector('.workspace-mode-switch [data-mode=code]').click()");
    assert.match(await evaluate(`window.adcode.files.read(${JSON.stringify(root + '/styles.css')}).then(file => file.text)`), /reviewed-mode-change/);
    process.stdout.write('PASS: real isolated proposals leave files unchanged, review shows actual line counts, and Apply all writes both project files.\n');
    await writeFile(join(root, 'index.html'), '<!doctype html><html><body><h1>Live chat preview works</h1></body></html>');
    await evaluate("document.querySelector('#panel-close').click()");
    await evaluate("document.querySelector('.workspace-mode-switch [data-mode=vibe]').click()");
    await evaluate("document.querySelector('[aria-label=\"Start a new conversation\"]').click()");
    assert.equal(await evaluate("window.adcode.ai.send('chat-preview-smoke')"), true);
    await waitFor("document.querySelector('.chat-live-preview iframe')?.getAttribute('src')?.startsWith('http://127.0.0.1:')");
    const previewRequest = requests.findLast(request => request.messages.some(message => message.role === 'user' && message.content === 'chat-preview-smoke'));
    assert.ok(previewRequest.messages.some(message => message.role === 'system' && message.content.includes(JSON.stringify(root))), 'The actual provider receives the selected workspace root');
    assert.ok(previewRequest.tools.some(tool => tool.function.name === 'open_preview'), 'The model is offered the live preview tool');
    const previewUrl = await evaluate("document.querySelector('.chat-live-preview iframe').src");
    assert.match(await (await fetch(previewUrl)).text(), /Live chat preview works/, 'The iframe URL serves the actual project');
    await evaluate("document.querySelector('.chat-live-preview').scrollIntoView({block:'start'})");
    await sleep(400);
    await screenshot('vibe-inline-preview');
    await clickText('.chat-live-preview button', 'Stop server');
    await waitFor("document.querySelector('.chat-live-preview iframe').hidden && document.querySelector('.chat-live-preview-status').textContent.includes('stopped')");
    await clickText('.chat-live-preview button', 'Start server');
    await waitFor("!document.querySelector('.chat-live-preview iframe').hidden");
    await clickText('.chat-live-preview button', 'Close preview');
    assert.equal(await evaluate("document.querySelector('.chat-live-preview') === null"), true);
    await evaluate("window.adcode.preview.stop()");
    process.stdout.write('PASS: workspace root reaches the provider; AI opens a real live server inside chat; stop, restart and close update the card.\n');
    process.stdout.write('PASS: active provider stream survives Vibe/Code switches; persisted tasks open real review in the same conversation.\n');
    process.stdout.write(`PASS: local API connection, saved agents, dependent Team traces, responsive chat, 100 streaming chunks in ${paints} DOM replacements, closed-chat completion, and installed skill discovery.\n`);
    process.stdout.write('PASS: on-demand assistant and saved history, dock/expand/close/reopen, launcher focus, retained transcript, MCP controls, bordered editor layout, narrow dock.\n');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
