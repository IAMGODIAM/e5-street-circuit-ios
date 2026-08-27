import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const webRoot = join(root, 'www');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.DS_Store') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

const records = [];
for (const path of await walk(webRoot)) {
  const bytes = await readFile(path);
  const info = await stat(path);
  records.push({
    path: relative(webRoot, path).split(sep).join('/'),
    bytes: info.size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

const canonical = records.map(({ path, bytes, sha256 }) => `${sha256} ${bytes} ${path}`).join('\n');
const manifest = {
  schema: 1,
  appId: 'com.e5enclave.streetcircuit',
  source: 'version-controlled www bundle; refreshes are explicit and reviewed',
  releaseId: createHash('sha256').update(canonical).digest('hex'),
  totalBytes: records.reduce((sum, file) => sum + file.bytes, 0),
  files: records,
};

await writeFile(join(root, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`release ${manifest.releaseId.slice(0, 12)} · ${records.length} files · ${manifest.totalBytes} bytes`);
