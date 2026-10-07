const DASHBOARD_URL = 'http://127.0.0.1:3210/dashboard';
const COPY = { on: 'Connected', connecting: 'Connecting…', off: 'Not connected' };

const statusEl = document.getElementById('status');
const labelEl = document.getElementById('label');
const detailEl = document.getElementById('detail');
const errorEl = document.getElementById('error');
const verEl = document.getElementById('ver');
const connectBtn = document.getElementById('connect');
const port = chrome.runtime.connect({ name: 'bridge-ui' });

function render(snapshot) {
  const phase = snapshot?.phase || 'off';
  statusEl.dataset.phase = phase;
  labelEl.textContent = COPY[phase] || COPY.off;
  detailEl.textContent = snapshot?.url || '';
  verEl.textContent = snapshot?.version ? `v${snapshot.version}` : '';
  errorEl.hidden = !snapshot?.error || phase === 'on';
  errorEl.textContent = snapshot?.error || '';
  connectBtn.textContent = phase === 'on' ? 'Reconnect' : 'Connect';
  connectBtn.disabled = phase === 'connecting';
}

port.onMessage.addListener(render);
connectBtn.addEventListener('click', () => {
  connectBtn.disabled = true;
  port.postMessage({ type: 'bridge-connect' });
});
document.getElementById('dashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: DASHBOARD_URL });
});
