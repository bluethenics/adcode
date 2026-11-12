/* The real chat widget, meters, menus and styles in Chromium, with deterministic usage. */
const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const esbuild = require('esbuild');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'adcode-composer-ui-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1040, height: 760, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadURL('about:blank');
    win.setPosition(-4000, 0); win.showInactive();
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const root = resolve(__dirname, '../../../..');
    const renderer = resolve(__dirname, '../../src/renderer');
    const css = [...readFileSync(join(renderer, 'main.ts'), 'utf8').matchAll(/import "\.\/styles\/([^\"]+)"/g)].map(match => readFileSync(join(renderer, 'styles', match[1]), 'utf8')).join('\n');
    const script = esbuild.buildSync({
      stdin: { contents: `export { createChatWidget } from './ai/chatWidget.ts'; export { createComposerUsage } from './ai/composerUsage.ts'; export { summarizeUsage } from '../shared/aiUsage.ts';`, resolveDir: renderer },
      tsconfig: join(root, 'tsconfig.json'), bundle: true, write: false, format: 'iife', globalName: 'ComposerFixture', platform: 'browser', target: 'es2022', logLevel: 'silent',
    }).outputFiles[0].text;
    const results = await win.webContents.executeJavaScript(`(async () => {
      const errors = []; window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
      // Chromium can defer a panel resize notification to the next frame during width changes.
      window.addEventListener('error', e => { if (e.message !== 'ResizeObserver loop completed with undelivered notifications.') errors.push(e.message); });
      document.head.append(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(css)} + 'body{display:block;margin:0;background:var(--bg-app);font-family:var(--font-ui)}#fixture{height:100vh}.chat-card{position:relative!important}' }));
      document.documentElement.dataset.theme = 'dark'; document.documentElement.dataset.reducedMotion = 'true';
      document.body.dataset.workspaceMode = 'vibe'; document.body.innerHTML = '<main id="fixture" class="vibe-workspace"></main>';
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const waitFor = async (test, label) => { const deadline = Date.now() + 3000; while (!test()) { if (Date.now() >= deadline) throw new Error(label + ' did not settle'); await pause(20); } };
      const listeners = new Map();
      const subscribe = key => listener => { const entries = listeners.get(key) ?? []; entries.push(listener); listeners.set(key, entries); return () => {}; };
      const emit = (key, value) => { for (const listener of listeners.get(key) ?? []) listener(value); };
      const group = (name, values = {}) => new Proxy(values, { get(target, key) { return target[key] ?? (String(key).startsWith('on') ? subscribe(name + '.' + key) : async () => null); } });
      const settings = { 'adcode.ai.provider': 'tagflow', 'adcode.ai.model': 'tagflow-code-27b' };
      let provider = 'tagflow', tokens = 11000, failAllowance = false, sent = [], cancelCalls = 0;
      const allowance = { available: true, blocked: false, limits: { dailyRequests: 50, dailyTokens: 100000, dailyCostMicros: 1000000, requestsPerMinute: 10 }, usage: { day: '2026-10-11', requests: 8, inputTokens: 16000, outputTokens: 4000, reservedTokens: 3000, costMicros: 100000, reservedCostMicros: 30000, estimatedRequests: 0 }, resetsAt: new Date('2026-10-12T00:00:00Z').getTime() };
      let localUsage;
      const status = () => ({ ready: true, activeProvider: provider, activeModel: settings['adcode.ai.model'], providers: [{ id: 'tagflow', displayName: 'Included AI', needsKey: false, hasKey: false, transport: 'openai', models: [{ id: 'tagflow-code-27b', name: 'Tagflow Code 27B', contextWindow: 32768 }, { id:'tagflow-next',name:'Tagflow Next',contextWindow:32768,recommended:true }] }], connections: [] });
      const api = {
        settings: group('settings', { read: async () => settings, write: async (key, value) => { const previous=settings[key];settings[key] = value;if(key==='adcode.ai.provider')provider=value;if(previous!==value&&key.startsWith('adcode.ai.')&&document.querySelector('.chat-composer .chat-send')?.dataset.mode==='stop')emit('ai.onEvent',{kind:'cancelled'});emit('settings.onChanged', settings); return settings; } }),
        ai: group('ai', { status: async () => status(), contextUsage: async () => ({ tokens, contextWindow: 32768, thresholdPercent: 80, autoCompact: true }), send: async text => { sent.push(text); return true; }, cancel: () => { cancelCalls++; } }),
        chat: group('chat', { sessions: async () => [], current: async () => null }),
        aiWorkspace: group('aiWorkspace', { list: async () => [], current: async () => null }),
        aiTeam: group('aiTeam', { list: async () => [] }),
        aiAutomation: group('aiAutomation', { list: async () => [], due: async () => [] }),
        aiUsage: group('aiUsage', { read: async () => localUsage, allowance: async () => { if (failAllowance) throw new Error('offline'); return allowance; } }),
      };
      window.adcode = new Proxy(api, { get(target, key) { return target[key] ?? group(String(key)); } });
      ${script}
      localUsage = ComposerFixture.summarizeUsage([], 'today', Date.now());
      const widget = ComposerFixture.createChatWidget({ openExternalPath: () => {}, openConnect: () => {}, saveAllOpenFiles: () => {}, requestOpen: () => widget.shown(false), requestClose: () => widget.hidden(), askForName: async () => null, mentionFiles: async () => ['src/app.ts'] });
      document.querySelector('#fixture').append(widget.element);
      widget.setDocked(true, document.createElement('aside')); widget.shown(false); await pause(160);
      const conversation = () => document.querySelector('.chat-conversation-controls');
      const result = { noQuotaMeters: !document.querySelector('.composer-meter'), conversationLabel: conversation().textContent === 'Conversation' };
      result.accessible = conversation().type === 'button' && conversation().getAttribute('aria-haspopup') === 'menu';
      conversation().click(); await pause(20);
      result.contextActions = [...document.querySelectorAll('.menu-item')].some(button => button.textContent.includes('Compact now'));
      document.querySelector('.menu-panel').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      result.contextFocus = document.activeElement === conversation() && conversation().getAttribute('aria-expanded') === 'false';
      conversation().click(); await pause(20);
      [...document.querySelectorAll('.menu-item')].find(button => button.textContent.includes('Usage by model')).click(); await pause(50);
      result.usageDetails = !!document.querySelector('.ai-usage-dialog[open]');
      [...document.querySelectorAll('.ai-usage-dialog button')].find(button => button.textContent === 'Done').click(); await pause(20);
      document.querySelector('.composer-help').click(); await pause(20);
      const fileAction = [...document.querySelectorAll('.menu-item')].find(button => button.textContent.includes('Add a project file'));
      result.shortcuts = !!fileAction;
      fileAction.click(); await waitFor(() => document.querySelector('.chat-input').value === '@', 'Project-file shortcut');
      result.fileShortcut = document.querySelector('.chat-input').value === '@';
      document.querySelector('.chat-input').value = ''; document.querySelector('.chat-input').dispatchEvent(new Event('input', { bubbles: true }));
      emit('ai.onEvent', { kind: 'context', tokens: 24000, contextWindow: 32768 });
      conversation().click(); await pause(20);
      result.liveContext = document.querySelector('.menu-panel').textContent.includes('24k');
      document.querySelector('.menu-panel').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      allowance.usage.inputTokens = 80000; emit('aiUsage.onChanged'); await pause(40);
      result.noQuotaAfterUpdate = !document.querySelector('.composer-meter');
      widget.hidden(); provider = 'custom'; widget.shown(false); await pause(80);
      result.externalNoQuota = !document.querySelector('.composer-meter') && conversation().textContent === 'Conversation';
      widget.hidden(); provider = 'tagflow'; allowance.usage.inputTokens = 16000; widget.shown(false); await pause(80);
      emit('ai.onEvent', { kind: 'context', tokens: 11000, contextWindow: 32768 });
      const input = document.querySelector('.chat-input'); input.value = 'Build a calculator'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await waitFor(() => sent.length === 1, 'Send');
      result.sendPreserved = sent.length === 1 && sent[0] === 'Build a calculator';
      emit('ai.onEvent', { kind: 'thinking' });
      result.stopPreserved = document.querySelector('.chat-composer .chat-send').dataset.mode === 'stop' && document.querySelector('.chat-composer .chat-send').getAttribute('aria-label') === 'Stop this turn';
      emit('ai.onEvent', { kind: 'turn-end' }); await pause(40);
      emit('ai.onEvent', { kind: 'tool-call', call: { id: 'plan-1', name: 'update_plan', input: { steps: [{ step: 'Read sample files', status: 'done' }, { step: 'Update the sample', status: 'in_progress' }, { step: 'Check the result', status: 'pending' }] } } });
      emit('ai.onEvent', { kind: 'tool-result', toolCallId: 'plan-1', name: 'update_plan', content: 'Plan updated' });
      emit('ai.onEvent', { kind: 'error', detail: 'Included AI returned HTTP 400: Choose an offered model and send text within its context limit. Image attachments are not supported by included AI. (code bad-request)' }); await pause(30);
      const plan = document.querySelector('.chat-plan');
      result.failedPlanSettles = plan.dataset.outcome === 'failed' && !plan.querySelector('[data-status="in_progress"]') && plan.querySelectorAll('[data-status="done"]').length === 1 && plan.textContent.includes('Failed · 1 of 3 done');
      const failure = document.querySelector('.chat-failure');
      result.includedRecovery = failure.querySelector('.chat-failure-title').textContent === 'Included AI rejected this request' && [...failure.querySelectorAll('button')].some(button => button.textContent === 'Switch model');
      emit('ai.onEvent', { kind: 'error', detail: 'Included AI returned HTTP 429: Your daily included AI allowance cannot cover this request. (code daily-limit)' }); await pause(30);
      const dailyFailure = [...document.querySelectorAll('.chat-failure')].at(-1);
      const usageAction = [...dailyFailure.querySelectorAll('button')].find(button => button.textContent === 'View AI usage');
      usageAction?.click(); await pause(40);
      result.dailyUsageAction = dailyFailure.dataset.failure === 'daily-limit' && !!usageAction && ![...dailyFailure.querySelectorAll('button')].some(button => button.textContent === 'Try again') && !!document.querySelector('.ai-usage-dialog[open]');
      [...document.querySelectorAll('.ai-usage-dialog button')].find(button => button.textContent === 'Done')?.click(); await pause(20);
      emit('ai.onEvent', { kind: 'tool-call', call: { id: 'plan-2', name: 'update_plan', input: { steps: [{ step: 'Read another sample', status: 'in_progress' }] } } });
      emit('ai.onEvent', { kind: 'cancelled' });
      const stoppedPlan = [...document.querySelectorAll('.chat-plan')].at(-1);
      result.cancelledPlanSettles = stoppedPlan.dataset.outcome === 'stopped' && !stoppedPlan.querySelector('[data-status="in_progress"]') && stoppedPlan.dataset.complete === 'false';
      emit('ai.onEvent', { kind: 'tool-call', call: { id: 'plan-3', name: 'update_plan', input: { steps: [{ step: 'Check the sample', status: 'in_progress' }] } } });
      emit('ai.onEvent', { kind: 'turn-end' });
      const endedPlan = [...document.querySelectorAll('.chat-plan')].at(-1);
      result.unfinishedPlanHonest = endedPlan.dataset.outcome === 'finished' && !endedPlan.querySelector('[data-status="in_progress"]') && endedPlan.dataset.complete === 'false' && endedPlan.textContent.includes('Turn ended · 0 of 1 done');
      const beforeWait=sent.length;
      emit('ai.onEvent',{kind:'status',text:'Free AI allowance reached. This task will resume automatically after tomorrow. Keep ADCode open; press Stop to cancel.'});
      await pause(80);
      result.automaticWaitVisible=document.querySelector('.chat-composer .chat-send').dataset.mode==='stop'&&document.querySelector('.chat-turn')!==null&&document.body.textContent.includes('This task will resume automatically');
      document.querySelector('.chat-model').click();await waitFor(()=>[...document.querySelectorAll('.model-picker-pick')].some(node=>node.textContent.includes('Tagflow Next')),'Next model in the picker');
      [...document.querySelectorAll('.model-picker-pick')].find(node=>node.textContent.includes('Tagflow Next')).click();
      await waitFor(()=>sent.length===beforeWait+1,'Waiting task model switch');
      result.switchingWaitingTask=settings['adcode.ai.model']==='tagflow-next'&&sent.at(-1).toLowerCase().includes('continue')&&sent.length===beforeWait+1;
      emit('ai.onEvent',{kind:'turn-end'});
      emit('ai.onEvent',{kind:'status',text:'Free AI is temporarily limited. This task will retry automatically after tomorrow. Press Stop to cancel.'});
      const beforeStop=sent.length;document.querySelector('.chat-composer .chat-send').click();emit('ai.onEvent',{kind:'cancelled'});await pause(50);
      result.stopCancelsWait=document.querySelector('.chat-composer .chat-send').dataset.mode==='send'&&sent.length===beforeStop;
      emit('ai.onEvent',{kind:'status',text:'Free AI allowance reached. This task will resume automatically after tomorrow. Keep ADCode open; press Stop to cancel.'});
      const beforeWorkspaceSends=sent.length, beforeWorkspaceCancels=cancelCalls;
      widget.setWorkspace('/another-project');
      emit('ai.onEvent',{kind:'cancelled'});await pause(50);
      result.workspaceCancelsWait=cancelCalls===beforeWorkspaceCancels+1&&sent.length===beforeWorkspaceSends&&document.querySelector('.chat-composer .chat-send').dataset.mode==='send';
      window.__composerWaitDiagnostics={stopMode:document.querySelector('.chat-composer .chat-send').dataset.mode,stopExtraSends:sent.length-beforeStop};
      // A slow account response must not overwrite totals after switching to another provider.
      let releaseAllowance, probeChanged, probeStopped = false, probeReads = 0;
      const probe = ComposerFixture.createComposerUsage({
        read: async () => { probeReads++; return localUsage; },
        allowance: () => new Promise(resolve => { releaseAllowance = resolve; }),
        onChanged: listener => { probeChanged = listener; return () => { probeStopped = true; }; },
      }, () => {});
      probe.setIncluded(true); await pause(10); probe.setIncluded(false);
      releaseAllowance({ ...allowance, usage: { ...allowance.usage, inputTokens: 100000 } }); await pause(20);
      result.providerRace = probe.elements[0].dataset.percent === 'unknown' && probe.elements[0].textContent.includes('0 today');
      probe.setVisible(true); await pause(10); probe.dispose(); const before = probeReads; probeChanged(); await pause(10);
      result.usageCleanup = probeStopped && before === probeReads;
      window.__composerWidget = widget; window.__composerErrors = errors;
      window.__composerLayout = () => {
        for (const animation of document.getAnimations()) animation.cancel();
        const form = document.querySelector('.chat-composer'), box = form.getBoundingClientRect();
        const controls = [...form.querySelectorAll('.chat-composer-utilities > *, .chat-composer-routing > *, .composer-meter, .composer-help')].filter(node => !node.hidden);
        return controls.every(node => { const rect = node.getBoundingClientRect(); return rect.left >= box.left && rect.right <= box.right + 1 && rect.width > 0; }) && form.scrollWidth <= form.clientWidth + 1;
      };
      return result;
    })()`);
    results.layouts = true;
    for (const width of [1040, 680, 480, 360]) {
      win.setContentSize(width, 760);
      await new Promise(resolve => setTimeout(resolve, 60));
      results.layouts &&= await win.webContents.executeJavaScript('window.__composerLayout()');
    }
    results.noErrors = await win.webContents.executeJavaScript('window.__composerErrors.length === 0');
    if(!results.automaticWaitVisible||!results.stopCancelsWait||!results.workspaceCancelsWait)console.log('WAIT_DIAGNOSTICS='+JSON.stringify(await win.webContents.executeJavaScript('window.__composerWaitDiagnostics')));
    if (!results.noErrors) console.error(await win.webContents.executeJavaScript('window.__composerErrors'));
    const screenshots = process.env.ADCODE_COMPOSER_SCREENSHOTS;
    if (screenshots) {
      mkdirSync(screenshots, { recursive: true });
      win.setPosition(-4000, 0); win.showInactive();
      for (const [name, width, theme] of [['composer-dark', 1040, 'dark'], ['composer-narrow', 400, 'dark'], ['composer-light', 1040, 'light']]) {
        win.setContentSize(width, 760);
        await win.webContents.executeJavaScript('document.documentElement.dataset.theme = ' + JSON.stringify(theme));
        await new Promise(resolve => setTimeout(resolve, 120));
        const rect = await win.webContents.executeJavaScript(`(() => { const r = document.querySelector('.chat-composer').getBoundingClientRect(); return { x: Math.max(0, Math.floor(r.x - 20)), y: Math.max(0, Math.floor(r.y - 20)), width: Math.min(innerWidth, Math.ceil(r.width + 40)), height: Math.min(innerHeight - Math.max(0, Math.floor(r.y - 20)), Math.ceil(r.height + 40)) }; })()`);
        writeFileSync(join(screenshots, name + '.png'), (await win.webContents.capturePage(rect)).toPNG());
      }
    }
    await win.webContents.executeJavaScript('window.__composerWidget.hidden()');
    console.log('COMPOSER_UI_RESULTS=' + JSON.stringify(results));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { win.destroy(); app.quit(); }
});
