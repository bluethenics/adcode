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
  try {
    await evaluate("window.adcode.settings.write('adcode.appearance.theme', 'light')");
    await evaluate("document.getElementById('ai-toggle').click()");
    await waitFor("document.querySelector('dialog[data-popup-id=chat]').open");
    await clickText('.chat-header button', 'Connect');
    await waitFor("document.querySelector('dialog[open] .connect-row') !== null");
    await clickText('dialog[open] .connect-panel button', 'Add API connection');
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
      await evaluate("[...document.querySelectorAll('.chat-header button')].find(el => el.getAttribute('aria-expanded') !== null && el.textContent !== 'History').click()");
    }
    await waitFor("document.querySelector('.ai-agent-library') !== null");
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
    process.stdout.write('PASS: NIM preset, named connection and key check through local API, saved agents, running team with dependent handoff and attributed tool traces, responsive composer, light/dark screenshots.\n');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
