/* Drives the real usage dialog and styles with deterministic local usage, without provider calls. */
const { app, BrowserWindow } = require('electron');
const { readFileSync, mkdtempSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const esbuild = require('esbuild');
app.setPath('userData', mkdtempSync(join(tmpdir(), 'adcode-usage-ui-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1100, height: 920, webPreferences: { backgroundThrottling: false } });
  try {
    await win.loadURL('about:blank');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const renderer = resolve(__dirname, '../../src/renderer');
    const imports = [...readFileSync(join(renderer, 'main.ts'), 'utf8').matchAll(/import "\.\/styles\/([^\"]+)"/g)];
    const css = imports.map(match => readFileSync(join(renderer, 'styles', match[1]), 'utf8')).join('\n');
    const script = esbuild.buildSync({ stdin: { contents: `export { openUsageDialog } from './ai/usageDialog.ts'; export { summarizeUsage, dayKey } from '../shared/aiUsage.ts'; export { usagePage } from '../shared/usagePage.ts'; export { shiftDay } from '../shared/usageActivity.ts';`, resolveDir: renderer }, bundle: true, write: false, format: 'iife', globalName: 'UsageFixture' }).outputFiles[0].text;
    const results = await win.webContents.executeJavaScript(`(async () => {
      ${script}
      document.head.append(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(css)} + 'body{display:block;margin:0;background:var(--bg-app);font-family:var(--font-ui)}' }));
      document.documentElement.dataset.theme = 'dark';
      document.documentElement.dataset.density = 'comfortable';
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const now = new Date(2026, 9, 10, 12).getTime(), today = UsageFixture.dayKey(now);
      const rows = Array.from({ length: 365 }, (_, index) => {
        const requests = index > 361 ? 4 : index % 9 === 0 ? 2 : 0;
        return { day: UsageFixture.shiftDay(today, index - 364), provider: 'tagflow', model: 'tagflow-code-27b', source: 'chat', requests, inputTokens: requests * 1200, outputTokens: requests * 450, estimatedRequests: 0, pricedRequests: requests, costMicros: 0 };
      });
      // Priced use from 2.6.1 on: chats, projects, hours and the cost split.
      const hoursAt = h => Array.from({ length: 24 }, (_, i) => i === h ? 3 : 0);
      for (let back = 0; back < 3; back++) rows.push({ day: UsageFixture.shiftDay(today, -back), provider: 'anthropic', model: 'claude-sonnet', source: 'chat', chat: back % 2 ? 'chat-b' : 'chat-a', project: back % 3 ? 'E:/work/shop' : 'E:/work/blog', requests: 3, inputTokens: 30000, cachedTokens: 20000, outputTokens: 3000, estimatedRequests: 0, pricedRequests: 3, costMicros: 81000, inputCostMicros: 30000, cacheReadCostMicros: 6000, outputCostMicros: 45000, cacheSavedMicros: 54000, hours: hoursAt(9 + back % 6), timedRequests: 3, durationMs: 6000, firstResponseMs: 1200, timedOutputTokens: 3000 });
      rows.push({ day: today, provider: 'custom', model: 'a-model-with-a-long-name-and-no-known-price', source: 'agents', requests: 2, inputTokens: 4500, outputTokens: 920, cachedTokens: 3000, estimatedRequests: 1, pricedRequests: 0, costMicros: 0 });
      let stored = rows, changed, failRead = true, failAllowance = true, unsubscribed = false, clearCalls = 0;
      const allowance = { available: true, blocked: false, limits: { dailyRequests: 50, dailyTokens: 1000000, dailyCostMicros: 1000000, requestsPerMinute: 10 }, usage: { day: today, requests: 8, inputTokens: 9000, outputTokens: 2000, costMicros: 100000, estimatedRequests: 0, reservedTokens: 1000, reservedCostMicros: 0 }, resetsAt: Date.parse(today + 'T00:00:00Z') + 86400000 };
      window.adcode = {
        ai: { status: async () => ({ providers: [{ id: 'anthropic', displayName: 'Anthropic', models: [{ id: 'claude-haiku', name: 'Claude Haiku', toolCall: true, reasoning: false, inputPrice: 1, outputPrice: 5 }, { id: 'claude-sonnet', name: 'Claude Sonnet', toolCall: true, reasoning: false, inputPrice: 3, outputPrice: 15 }] }, { id: 'tagflow', displayName: 'Tagflow', models: [{ id: 'tagflow-code-27b', name: 'Tagflow Code', toolCall: true, reasoning: false, inputPrice: 0.2, outputPrice: 0.8 }] }] }) },
        chat: { sessions: async () => [{ id: 'chat-a', title: 'Fix the checkout bug' }] },
        aiUsage: {
        read: async (range, filter) => { if (failRead) { failRead = false; throw new Error('offline'); } return { ...UsageFixture.summarizeUsage(stored, range, now), page: UsageFixture.usagePage(stored, range, now, filter) }; },
        allowance: async () => { if (failAllowance) { failAllowance = false; throw new Error('offline'); } return allowance; },
        clear: async () => { clearCalls++; stored = []; },
        onChanged: listener => { changed = listener; return () => { unsubscribed = true; }; },
      } };
      UsageFixture.openUsageDialog(); await pause(80);
      const button = label => [...document.querySelectorAll('button')].find(button => button.textContent === label);
      const results = { recoverableErrors: !!button('Try again') && !!button('Retry') };
      button('Try again').click(); button('Retry').click(); await pause(90);
      results.activityCalendar = document.querySelectorAll('button.usage-calendar-cell').length === 365;
      results.realStreaks = document.querySelector('.usage-activity-stats').textContent.includes('Current streak3 days') && document.querySelector('.usage-activity-stats').textContent.includes('Longest streak3 days');
      const allowanceCard = document.querySelector('.usage-allowance');
      results.realAllowance = allowanceCard.textContent.includes('AI requests left42') && allowanceCard.textContent.includes('of 50 daily requests');
      results.oneMillionTokens = allowanceCard.textContent.includes('Tokens left today988,000') && allowanceCard.textContent.includes('of 1,000,000 daily tokens');
      const meters = [...allowanceCard.querySelectorAll('progress')];
      results.remainingBars = meters[0].value === 988000 && meters[0].max === 1000000 && meters[0].getAttribute('aria-label') === 'Tokens remaining today' && meters[1].value === 42;
      results.heldTokensExplained = allowanceCard.textContent.includes('11,000 tokens used') && allowanceCard.textContent.includes('1,000 held for active replies');
      results.inputOutputBreakdown = allowanceCard.textContent.includes('9,000 input (read)') && allowanceCard.textContent.includes('2,000 output (written)') && allowanceCard.textContent.includes('provider-reported counts');
      results.repeatedContextExplained = document.querySelector('.usage-allowance-help').textContent.includes('These input tokens count each time') && document.querySelector('.usage-allowance-help').textContent.includes('200,000 input tokens');
      allowance.usage.estimatedRequests = 2; changed(); await pause(40);
      results.estimatedAllowanceVisible = allowanceCard.textContent.includes('2 requests have estimated counts');
      allowance.usage.estimatedRequests = 0; changed(); await pause(40);
      results.plainLanguageHelp = document.querySelector('.usage-allowance-help').textContent.includes('One message can use several AI requests') && document.querySelector('.usage-allowance-help').textContent.includes('you are not charged');
      document.querySelector('.usage-view[data-view="limits"]').click(); await pause(20);
      const help = document.querySelector('.usage-allowance-help'); help.open = true; const helpSummary = help.querySelector('summary'); helpSummary.focus(); changed(); await pause(40);
      results.helpStaysOpen = document.querySelector('.usage-allowance-help') === help && help.open && document.activeElement === helpSummary;
      help.open = false;
      document.querySelector('.usage-view[data-view="cost"]').click(); await pause(20);
      const body = document.querySelector('.usage-body');
      results.unknownCost = body.querySelector('.usage-breakdown').textContent.includes('No price') && body.querySelector('.usage-breakdown').textContent.includes('≈');
      const cachedTile = [...body.querySelectorAll('.usage-tile')].find(tile => tile.textContent.startsWith('Cached input'));
      results.cachedVisible = !!cachedTile && cachedTile.querySelector('.usage-tile-value').textContent !== '0' && body.textContent.includes('Cache savings') && body.textContent.includes('Cache read');
      results.breadcrumb = document.querySelector('.usage-crumbs').textContent.startsWith('Usage/All projects') && document.querySelectorAll('.usage-crumb-select').length === 2;
      results.sections = body.querySelectorAll('.usage-panel').length >= 9 && !!body.querySelector('.usage-summary li') && !!body.querySelector('.usage-hero-value').textContent.startsWith('$');
      results.providerRows = body.querySelectorAll('.usage-provider').length === 3;
      const area = body.querySelector('.usage-area-wrap'), box = area.getBoundingClientRect();
      area.dispatchEvent(new PointerEvent('pointermove', { clientX: box.right - 2, clientY: box.top + 20, bubbles: true }));
      results.chartTooltip = area.dataset.active === 'true' && area.querySelector('.usage-tip').textContent.includes('Anthropic');
      const otherRow = body.querySelector('.usage-provider[data-series-row="custom"]');
      otherRow.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
      const dimmed = [...body.querySelectorAll('.usage-area-layer')].filter(layer => layer.getAttribute('data-dim') === 'true').length;
      const lit = !body.querySelector('.usage-key[data-provider="custom"]');
      body.querySelector('.usage-top').dispatchEvent(new PointerEvent('pointerleave'));
      const indicator = document.querySelector('.usage-tabs .usage-seg-indicator');
      results.motionDetails = document.querySelectorAll('.usage-seg-indicator').length === 4 && indicator.style.transform.startsWith('translateX(') && dimmed >= 1 && lit && body.querySelectorAll('.usage-area-layer[data-dim]').length === 0;
      const tabsOf = () => [...document.querySelectorAll('.usage-section-tab')];
      results.sectionTabs = tabsOf().length === 4 && tabsOf()[0].getAttribute('aria-selected') === 'true' && document.querySelectorAll('.usage-section:not([hidden])').length === 1 && document.querySelector('.usage-sections-note').textContent.length > 20;
      const cards = [...body.querySelectorAll('.usage-model-card')];
      const head = cards[0]?.querySelector('.usage-model-head');
      head?.click();
      const options = [...body.querySelectorAll('.usage-whatif-select option')].map(option => option.textContent);
      results.yourModels = cards.length === 3 && cards[0].textContent.includes('claude-sonnet') && head.getAttribute('aria-expanded') === 'true' && !cards[0].querySelector('.usage-model-details').hidden
        && options.length === 2 && !options.some(text => text.includes('Haiku')) && !/plus 35%|markup/i.test(document.querySelector('.ai-usage-dialog').textContent);
      head?.click();
      results.moreThanT3 = body.querySelectorAll('.usage-hours-cell').length >= 168 && body.querySelector('.usage-chats').textContent.includes('Fix the checkout bug') && body.querySelector('.usage-whatif-value').textContent.startsWith('up to $') && body.textContent.includes('Fastest');
      const viewButton = label => [...document.querySelectorAll('.usage-view')].find(item => item.textContent === label);
      viewButton('Tokens').click(); await pause(20);
      results.tokensView = document.querySelector('.usage-body').textContent.includes('Tokens by type') && !document.querySelector('.usage-hero-value').textContent.startsWith('$');
      viewButton('Limits').click(); await pause(20);
      results.limitsView = document.querySelector('.usage-body').hidden && !document.querySelector('.usage-limits').hidden && document.querySelector('.usage-limits .usage-allowance').offsetHeight > 0;
      viewButton('Cost').click(); await pause(20);
      const providerSelect = document.querySelectorAll('.usage-crumb-select')[1];
      providerSelect.value = 'anthropic'; providerSelect.dispatchEvent(new Event('change')); await pause(60);
      results.providerFilter = document.querySelectorAll('.usage-provider').length === 1 && document.querySelectorAll('.usage-crumb-select')[1].value === 'anthropic';
      document.querySelectorAll('.usage-crumb-select')[1].value = ''; document.querySelectorAll('.usage-crumb-select')[1].dispatchEvent(new Event('change')); await pause(60);
      tabsOf()[2].click(); await pause(20);
      results.sectionSwitch = !document.querySelector('#usage-section-when').hidden && document.querySelector('#usage-section-overview').hidden;
      const todayCell = document.querySelector('[data-day="' + today + '"]');
      todayCell.focus(); todayCell.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      results.arrowNavigation = document.activeElement.dataset.day === UsageFixture.shiftDay(today, -7);
      results.oneCalendarStop = document.querySelectorAll('button.usage-calendar-cell[tabindex="0"]').length === 1;
      const selected = document.activeElement.dataset.day;
      document.querySelector('.usage-calendar-scroll').scrollLeft = 12;
      changed(); await pause(90);
      results.livePreservesFocus = document.activeElement.dataset.day === selected && document.querySelector('.usage-calendar-scroll').scrollLeft <= 12;
      const range = document.querySelector('[role="tab"][aria-selected="true"]'); range.focus();
      range.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); await pause(90);
      results.rangeTabs = document.activeElement.textContent === '90 days' && document.querySelector('[role="tabpanel"]').getAttribute('aria-labelledby') === document.activeElement.id;
      results.annualActivityStable = document.querySelectorAll('button.usage-calendar-cell').length === 365;
      allowance.usage.costMicros = 1000000; changed(); await pause(40);
      results.budgetLimitVisible = document.querySelector('.usage-allowance-warning').textContent.includes("Today's service budget is used up");
      allowance.usage.costMicros = 100000; changed(); await pause(40);
      allowance.limits.dailyRequests = 1000000; allowance.limits.requestsPerMinute = 1000; allowance.usage.requests = 1000001; changed(); await pause(40);
      results.unlimitedRequests = allowanceCard.textContent.includes('AI requestsUnlimited') && allowanceCard.textContent.includes('1,000,001 requests used today') && allowanceCard.querySelectorAll('progress').length === 1 && !allowanceCard.querySelector('.usage-allowance-warning');
      results.unlimitedRateExplained = help.textContent.includes('ADCode has no per-minute request cap') && help.textContent.includes('provider may still limit');
      window.__usageAllowance = allowance;
      window.__usageResults = results;
      window.__usageChanged = changed;
      window.__usageClear = () => clearCalls;
      window.__usageUnsubscribed = () => unsubscribed;
      return results;
    })()`);
    results.layouts = true;
    for (const theme of ['dark', 'light', 'midnight']) {
      for (const [width, height] of [[1100, 920], [680, 760], [360, 560]]) {
        win.setContentSize(width, height);
        // Hidden Chromium windows may defer resize notifications until a frame is drawn.
        await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
        await win.webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
        await new Promise(resolve => setTimeout(resolve, 70));
        const layout = await win.webContents.executeJavaScript(`(() => {
          const dialog = document.querySelector('.ai-usage-dialog'), body = document.querySelector('.usage-body'), rect = dialog.getBoundingClientRect(), footer = document.querySelector('.usage-footer').getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight && footer.bottom <= innerHeight && body.clientHeight > 80 && body.scrollWidth <= body.clientWidth + 1;
        })()`);
        results.layouts &&= layout;
        if (!layout) console.log('USAGE_LAYOUT=' + JSON.stringify({ theme, width, height, bounds: await win.webContents.executeJavaScript(`(() => { const dialog = document.querySelector('.ai-usage-dialog'), body = document.querySelector('.usage-body'); return { viewport: [innerWidth, innerHeight], dialog: dialog.getBoundingClientRect().toJSON(), body: [body.clientHeight, body.clientWidth, body.scrollWidth], overflowing: [...body.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > body.getBoundingClientRect().right + 1).slice(0, 5).map(el => el.className) }; })()`) }));
      }
    }
    results.sharedWeekly = await win.webContents.executeJavaScript(`(async () => {
      const allowance = window.__usageAllowance;
      allowance.unlimited = false;
      allowance.tokens = { enabled: true, free: { limit: 11000000, used: 6300000, held: 100000, remaining: 4600000, resetsAt: Date.now() + 86400000 }, purchased: 0, paidModels: ['tagflow-code-27b'] };
      window.__usageChanged(); await new Promise(resolve => setTimeout(resolve, 80));
      const card = document.querySelector('.usage-allowance');
      const result = card.textContent.includes('Included AI · Free') && card.textContent.includes('Tagflow AI and all other included models') && !card.textContent.includes('Unlimited') && card.querySelectorAll('progress').length === 1;
      delete allowance.tokens; delete allowance.unlimited; window.__usageChanged(); await new Promise(resolve => setTimeout(resolve, 80));
      return result;
    })()`);
    results.reducedMotion = await win.webContents.executeJavaScript(`(() => { document.documentElement.dataset.reducedMotion = 'true'; return getComputedStyle(document.querySelector('.ad-btn')).transitionDuration === '0s'; })()`);
    // Reported on a laptop: the balance cards sat outside the scrolling area, leaving the range
    // content a strip about one row tall. Everything but the footer now scrolls together.
    win.setContentSize(1140, 600);
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1140, height: 600, deviceScaleFactor: 1, mobile: false });
    await new Promise(resolve => setTimeout(resolve, 120));
    results.roomyScroll = await win.webContents.executeJavaScript(`(() => {
      const scroller = document.querySelector('.usage-scroll'), card = document.querySelector('.ai-usage-dialog .form-dialog-card');
      return scroller !== null && scroller.contains(document.querySelector('.usage-allowance')) && scroller.contains(document.querySelector('.usage-body'))
        && scroller.clientHeight >= card.clientHeight * 0.6 && getComputedStyle(document.querySelector('.usage-toolbar')).position === 'sticky';
    })()`);
    win.setContentSize(1100, 920);
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1100, height: 920, deviceScaleFactor: 1, mobile: false });
    await win.webContents.executeJavaScript("document.documentElement.dataset.theme='dark'; document.querySelector('[role=tab]').click();");
    await new Promise(resolve => setTimeout(resolve, 90));
    await win.webContents.executeJavaScript("document.querySelector('.usage-scroll').scrollTop = 0; document.querySelector('[role=tab]').focus({ preventScroll: true });");
    if (process.env.ADCODE_USAGE_SCREENSHOT) {
      win.setPosition(-4000, 0); win.showInactive();
      await new Promise(resolve => setTimeout(resolve, 180));
      writeFileSync(process.env.ADCODE_USAGE_SCREENSHOT, (await win.webContents.capturePage()).toPNG());
      win.hide();
    }
    Object.assign(results, await win.webContents.executeJavaScript(`(async () => {
      const pause = () => new Promise(resolve => setTimeout(resolve, 80));
      const button = label => [...document.querySelectorAll('button')].find(button => button.textContent === label);
      button('Clear usage').click(); await pause();
      const confirm = document.querySelector('.confirm-dialog');
      const explainsLocal = confirm?.textContent.includes('streaks') && confirm?.textContent.includes('allowance');
      [...confirm.querySelectorAll('button')].find(button => button.textContent === 'Clear').click(); await pause();
      const result = { clearIsLocal: explainsLocal && window.__usageClear() === 1 && document.querySelector('.usage-body').textContent.includes('Nothing used yet') && document.querySelector('.usage-allowance').textContent.includes('AI requestsUnlimited'), emptyCalendar: document.querySelectorAll('button.usage-calendar-cell').length === 365 && document.querySelector('.usage-activity-stats').textContent.includes('Current streak0 days') };
      button('Done').click(); await pause(); result.cleanClose = !document.querySelector('.ai-usage-dialog') && window.__usageUnsubscribed();
      return result;
    })()`));
    console.log('USAGE_DIALOG_RESULTS=' + JSON.stringify(results));
    app.exit(Object.values(results).every(value => value === true) ? 0 : 1);
  } catch (error) { console.error(error); app.exit(1); }
});
