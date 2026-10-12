const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parseHTML } = require('linkedom');
const root = path.join(__dirname, '..');
function load(relative, mocks, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: id => {
    assert.ok(id in mocks, `Unexpected import ${id}`);
    return mocks[id];
  }, URL, setTimeout, ...globals });
  return exports;
}
async function apiTests() {
  let payload = { provider: 'mlx-whisper', available: true, status: 'installed', sizeBytes: 1 };
  const requests = [];
  const api = load('src/transcript-generator/api.ts', {
    './native-client': { startHelper: async () => ({ url: 'http://127.0.0.1:8484', token: 'test-only' }), clearHelperSession() {} },
  }, { fetch: async (url, init) => { requests.push({url, init}); return { ok: true, json: async () => payload }; } });
  await api.downloadModel('tiny', 'mlx-whisper');
  assert.ok(requests.at(-1).url.endsWith('/v1/models/tiny/download?provider=mlx-whisper'));
  payload = { provider: 'openai-whisper', available: true, status: 'installed', sizeBytes: 1 };
  await api.deleteModel('tiny', 'openai-whisper');
  assert.equal(requests.at(-1).init.method, 'DELETE');
  assert.ok(requests.at(-1).url.endsWith('?provider=openai-whisper'));
  payload = { status: 'installed', sizeBytes: 1 }; // Old Helper ignores provider.
  const before = requests.length;
  await assert.rejects(api.deleteModel('tiny', 'mlx-whisper'), /更新/);
  assert.equal(requests.length, before + 1); // No destructive request to old Helper.
  await api.getModelStatus('tiny'); // Old Faster Whisper Helper remains compatible.
  payload = { provider: 'mlx-whisper', available: false, reason: 'unsupported', status: 'not-installed' };
  await assert.rejects(api.downloadModel('tiny', 'mlx-whisper'), /unsupported/);
  payload = { task_id: 'test-task' };
  await api.createTranscription('https://youtube.com/watch?v=test', { provider: 'openai-whisper', whisperModel: 'small' }, []);
  assert.equal(JSON.parse(requests.at(-1).init.body).provider, 'openai-whisper');
}
async function settingsTests() {
  // Test actual settings DOM with mocked Helper/storage; no extension installation.
  const { document, window } = parseHTML(fs.readFileSync(path.join(root, 'src/settings.html'), 'utf8'));
  // linkedom's select.value is getter-only, unlike a browser.
  Object.defineProperty(window.HTMLSelectElement.prototype, 'value', {
    get() { return this._value ?? this.querySelector('option[selected]')?.value ?? this.querySelector('option')?.value ?? ''; },
    set(value) { this._value = value; }, configurable: true,
  });
  const empty = () => ({ mode: 'off', cookies: [], status: 'empty', updatedAt: null, lastValidatedAt: null });
  let saved;
  const calls = [];
  const types = load('src/transcript-generator/types.ts', {});
  const mod = load('src/managers/transcript-generator-settings.ts', {
    '../transcript-generator/api': {
      getModelStatus: async (model, provider) => { calls.push([model, provider]); return { status: 'installed', sizeBytes: 1048576, available: true }; },
      downloadModel: async (model, provider) => calls.push([model, provider]),
      deleteModel: async (model, provider) => calls.push([model, provider]),
    },
    '../transcript-generator/cookies': {},
    '../transcript-generator/types': types,
    '../transcript-generator/storage': {
      loadTranscriptGeneratorSettings: async () => ({ general: { enabled: true }, asr: { provider: 'faster-whisper', whisperModel: 'tiny' }, cookies: { bilibili: empty(), youtube: empty() } }),
      saveAsrSettings: async value => { saved = value; },
    },
    '../transcript-generator/native-client': { getHelperStatus: async () => ({ status: 'not-installed' }) },
  }, { document, confirm: () => true });
  await mod.initializeTranscriptGeneratorSettings();
  const provider = document.getElementById('transcript-generator-provider');
  for (const id of ['openai-whisper', 'mlx-whisper']) {
    assert.ok(provider.querySelector(`option[value="${id}"]`));
    provider.value = id;
    await provider.onchange();
    assert.equal(saved.provider, id);
    assert.equal(document.getElementById('transcript-generator-model-controls').hidden, false);
    document.getElementById('transcript-generator-model-refresh').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.at(-1)[1], id);
    assert.match(document.getElementById('transcript-generator-model-status').textContent, /已安装/);
  }
  provider.value = 'bcut';
  await provider.onchange();
  assert.equal(document.getElementById('transcript-generator-model-controls').hidden, true);
  assert.equal(document.getElementById('transcript-generator-bcut-notice').hidden, false);
}
async function storageTests() {
  const data = {};
  const browser = { storage: { local: { get: async () => data, set: async next => Object.assign(data, next) } } };
  const storage = load('src/transcript-generator/storage.ts', { '../utils/browser-polyfill': { default: browser } });
  assert.equal((await storage.loadTranscriptGeneratorSettings()).asr.provider, 'faster-whisper');
  await storage.saveAsrSettings({ provider: 'mlx-whisper', whisperModel: 'large-v3-turbo' });
  const loaded = (await storage.loadTranscriptGeneratorSettings()).asr;
  assert.equal(loaded.provider, 'mlx-whisper');
  assert.equal(loaded.whisperModel, 'large-v3-turbo');
}
(async () => {
  await apiTests(); await settingsTests(); await storageTests();
  console.log('PASS: provider routing, old Helper protection, settings DOM, configuration persistence');
})().catch(error => { console.error(error); process.exitCode = 1; });
