const statusEl = document.querySelector('#status') as HTMLElement;
const codeEl = document.querySelector('#code') as HTMLInputElement;
const portEl = document.querySelector('#port') as HTMLInputElement;
const writesEl = document.querySelector('#writes') as HTMLInputElement;
const pairEl = document.querySelector('#pair') as HTMLButtonElement;
const forgetEl = document.querySelector('#forget') as HTMLButtonElement;

const LABELS: Record<string, string> = {
  connected: 'Connected to the local server',
  connecting: 'Connecting...',
  disconnected: 'Not connected. Is your MCP client running?',
  pairing_failed: 'Pairing failed. Check the code and try again.',
};

async function refresh(): Promise<void> {
  const local = await chrome.storage.local.get(['port', 'allowWrites', 'secret']);
  const session = await chrome.storage.session.get('connection');
  const connection = session.connection as { status?: string } | undefined;
  statusEl.textContent = LABELS[connection?.status ?? 'disconnected'] ?? '';
  portEl.value = String(local.port ?? 47821);
  writesEl.checked = local.allowWrites === true;
  forgetEl.hidden = !local.secret;
}

pairEl.addEventListener('click', () => {
  const code = codeEl.value.trim().toUpperCase();
  const port = Number(portEl.value);
  void chrome.storage.local.remove('secret').then(() =>
    chrome.storage.local.set({
      ...(code ? { pendingCode: code } : {}),
      ...(Number.isInteger(port) && port > 0 ? { port } : {}),
    }),
  );
  codeEl.value = '';
});

writesEl.addEventListener('change', () => {
  void chrome.storage.local.set({ allowWrites: writesEl.checked });
});

forgetEl.addEventListener('click', () => {
  void chrome.storage.local.remove(['secret', 'pendingCode']).then(refresh);
});

chrome.storage.onChanged.addListener(() => void refresh());
void refresh();
