// Runs on the local dashboard. Forwards bridge state from the service worker
// into the page, and forwards the page's Connect click back to the worker.

const port = chrome.runtime.connect({ name: 'bridge-ui' });

function reply(snapshot) {
  window.postMessage({
    source: 'jobyougo-extension',
    installed: true,
    ...snapshot,
    type: 'status',
  }, window.location.origin);
}

port.onMessage.addListener(reply);
port.onDisconnect.addListener(() => reply({ phase: 'off', error: 'Plugin disconnected' }));

window.addEventListener('message', (event) => {
  if (event.source !== window || event.data?.source !== 'jobyougo-dashboard') return;
  if (event.data.type === 'connect') port.postMessage({ type: 'bridge-connect' });
  else if (event.data.type === 'hello') port.postMessage({ type: 'bridge-status' });
});

// "Fill with the plugin" clicked in the helper over an offer tab. No
// `installed` flag: the page's status listener must not read it as a phase.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'helper-fill') return false;
  window.postMessage({ ...msg, source: 'jobyougo-extension' }, window.location.origin);
  sendResponse({ ok: true });
  return false;
});
