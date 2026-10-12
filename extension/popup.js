const DASHBOARD_URL = 'http://127.0.0.1:3210/dashboard';
const COPY = { on: 'Connected', connecting: 'Connecting…', off: 'Not connected' };

const statusEl = document.getElementById('status');
const labelEl = document.getElementById('label');
const detailEl = document.getElementById('detail');
const errorEl = document.getElementById('error');
const verEl = document.getElementById('ver');
const connectBtn = document.getElementById('connect');
const scanBtn = document.getElementById('scan-apply');
const tabEl = document.getElementById('tab');
const progressEl = document.getElementById('progress');
const progressText = document.getElementById('progress-text');
const port = chrome.runtime.connect({ name: 'bridge-ui' });
port.postMessage({ type: 'ui-role', role: 'popup' });

let phase = 'off';
let offerTab = null;

function isOfferTab(tab) {
  const url = tab?.url || '';
  return /^https?:\/\//i.test(url) && !/^https?:\/\/(127\.0\.0\.1|localhost):3210\//i.test(url);
}

function render(snapshot) {
  phase = snapshot?.phase || 'off';
  statusEl.dataset.phase = phase;
  labelEl.textContent = COPY[phase] || COPY.off;
  detailEl.textContent = snapshot?.url || '';
  verEl.textContent = snapshot?.version ? `v${snapshot.version}` : '';
  errorEl.hidden = !snapshot?.error || phase === 'on';
  errorEl.textContent = snapshot?.error || '';
  connectBtn.textContent = phase === 'on' ? 'Reconnect' : 'Connect';
  connectBtn.disabled = phase === 'connecting';
  paintTab();
}

function showProgress(nextPhase, text) {
  const on = Boolean(text);
  progressEl.hidden = !on;
  progressEl.dataset.phase = nextPhase || '';
  progressText.textContent = text || '';
  const working = nextPhase === 'run' || nextPhase === 'wait';
  scanBtn.dataset.busy = working ? '1' : '';
  scanBtn.textContent = working ? 'Working on this tab…' : 'Scan & apply this tab';
  paintTab();
}

function paintTab() {
  const usable = phase === 'on' && isOfferTab(offerTab);
  scanBtn.disabled = !usable || scanBtn.dataset.busy === '1';
  if (!offerTab) tabEl.textContent = '';
  else if (!isOfferTab(offerTab)) tabEl.textContent = 'Open a job offer in this window, then click the button.';
  else if (phase !== 'on') tabEl.textContent = 'Connect first. Scan and apply stay on this offer tab.';
  else tabEl.textContent = offerTab.title || offerTab.url;
}

async function loadOfferTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  offerTab = tab || null;
  paintTab();
}

port.onMessage.addListener((msg) => {
  if (msg?.type === 'scan-apply-progress') {
    if (!offerTab || Number(msg.tabId) !== Number(offerTab.id)) return;
    showProgress(msg.phase, msg.text);
    return;
  }
  if (msg?.type === 'scan-apply-result') {
    if (!msg.ok) {
      showProgress('bad', msg.error || 'Could not start on this tab.');
      errorEl.hidden = false;
      errorEl.textContent = msg.error || 'Could not start on this tab.';
    }
    return;
  }
  render(msg);
});
connectBtn.addEventListener('click', () => {
  connectBtn.disabled = true;
  port.postMessage({ type: 'bridge-connect' });
});
document.getElementById('dashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: DASHBOARD_URL });
});
scanBtn.addEventListener('click', () => {
  if (!isOfferTab(offerTab) || phase !== 'on') return;
  showProgress('run', 'Reading this offer…');
  errorEl.hidden = true;
  port.postMessage({
    type: 'scan-apply-tab',
    tabId: offerTab.id,
    url: offerTab.url,
    title: offerTab.title || '',
  });
});
loadOfferTab().then(() => {
  if (offerTab?.id) port.postMessage({ type: 'scan-apply-status', tabId: offerTab.id });
});
