// A fresh install has no portals.yml: the first dashboard load asks for the
// portals and the queries at once, and both used to copy the template. On
// Windows the second copy failed and that request answered 500. The server
// starts on import, so the two functions are evaluated from the source text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const server = readFileSync(join(ROOT, 'ui/server.mjs'), 'utf8');

function sourceOf(name) {
  const start = server.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, `${name} is defined`);
  const end = server.indexOf('\n}\n', start);
  return server.slice(start, end + 2);
}

test('two first requests seed portals.yml once and both get it', async () => {
  const files = new Set(['templates/portals.example.yml']);
  let copies = 0;
  let copying = false;
  const context = {
    IS_VERCEL: false,
    ROOT: '.',
    PORTALS_FILE: 'portals.yml',
    PORTALS_EXAMPLE: 'templates/portals.example.yml',
    portalsSeeding: null,
    join: (...parts) => parts.join('/'),
    dirname: () => '.',
    mkdir: async () => {},
    access: async (path) => { if (!files.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
    // A second copy while the first one writes fails, as on Windows.
    copyFile: async (src, dst) => {
      if (copying) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      copying = true;
      await new Promise(resolve => setTimeout(resolve, 20));
      files.add(dst);
      copies++;
      copying = false;
    },
    console: { warn() {}, log() {} },
  };
  vm.createContext(context);
  vm.runInContext(`${sourceOf('ensurePortalsFile')}\n${sourceOf('seedPortalsFile')}\nthis.ensure = ensurePortalsFile;`, context);
  const results = await Promise.all([context.ensure(), context.ensure()]);
  assert.deepEqual(results, ['portals.yml', 'portals.yml']);
  assert.equal(copies, 1);
  assert.equal(await context.ensure(), 'portals.yml', 'an existing file is returned without a copy');
  assert.equal(copies, 1);
});
