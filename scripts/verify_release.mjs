import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const webRoot = join(root, 'www');
const manifest = JSON.parse(await readFile(join(root, 'release-manifest.json'), 'utf8'));
const config = JSON.parse(await readFile(join(root, 'capacitor.config.json'), 'utf8'));
const EXPECTED_APP_ID = 'com.e5enclave.streetcircuit';
const MAX_RELEASE_BYTES = 40 * 1024 * 1024;
const MAX_MODEL_BYTES = 6 * 1024 * 1024;
const VERIFY_NATIVE_BUNDLE = process.env.VERIFY_NATIVE_BUNDLE === '1';

if (manifest.schema !== 1 || manifest.appId !== EXPECTED_APP_ID || config.appId !== EXPECTED_APP_ID) {
  throw new Error('release identity or manifest schema drift');
}

if (config.server?.url || config.server?.allowNavigation) {
  throw new Error('production Capacitor config must not load or navigate the app from a remote server');
}

async function walk(dir) {
  const out = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.DS_Store') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

const actual = new Map();
let actualBytes = 0;
for (const path of await walk(webRoot)) {
  const bytes = await readFile(path);
  actualBytes += bytes.length;
  const releasePath = relative(webRoot, path).split(sep).join('/');
  if (/\.(gltf|glb)$/i.test(releasePath) && bytes.length > MAX_MODEL_BYTES) throw new Error(`3D asset exceeds ${MAX_MODEL_BYTES} byte budget: ${releasePath}`);
  actual.set(releasePath, {
    bytes: (await stat(path)).size,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

if (manifest.files.length !== new Set(manifest.files.map(file => file.path)).size) {
  throw new Error('release manifest contains duplicate paths');
}
const canonical = manifest.files.map(({ path, bytes, sha256 }) => `${sha256} ${bytes} ${path}`).join('\n');
const releaseId = createHash('sha256').update(canonical).digest('hex');
if (manifest.releaseId !== releaseId) throw new Error('release manifest ID is invalid');
if (manifest.totalBytes !== actualBytes) throw new Error('release manifest byte total is invalid');
if (actualBytes > MAX_RELEASE_BYTES) throw new Error(`release exceeds ${MAX_RELEASE_BYTES} byte budget`);

for (const expected of manifest.files) {
  const found = actual.get(expected.path);
  if (!found) throw new Error(`release file missing: ${expected.path}`);
  if (found.bytes !== expected.bytes || found.sha256 !== expected.sha256) {
    throw new Error(`release file drift: ${expected.path}`);
  }
  actual.delete(expected.path);
}
if (actual.size) throw new Error(`unmanifested release files: ${[...actual.keys()].join(', ')}`);

if (VERIFY_NATIVE_BUNDLE) {
  const nativeWebRoot = join(root, 'ios/App/App/public');
  const nativeFiles = new Map();
  for (const path of await walk(nativeWebRoot)) {
    const bytes = await readFile(path);
    nativeFiles.set(relative(nativeWebRoot, path).split(sep).join('/'), {
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  for (const expected of manifest.files) {
    const found = nativeFiles.get(expected.path);
    if (!found || found.bytes !== expected.bytes || found.sha256 !== expected.sha256) {
      throw new Error(`native web bundle is out of sync: ${expected.path}`);
    }
    nativeFiles.delete(expected.path);
  }
  for (const generated of ['cordova.js', 'cordova_plugins.js']) nativeFiles.delete(generated);
  if (nativeFiles.size) throw new Error(`unexpected native web files: ${[...nativeFiles.keys()].join(', ')}`);

  const nativeConfig = JSON.parse(await readFile(join(root, 'ios/App/App/capacitor.config.json'), 'utf8'));
  if (nativeConfig.appId !== manifest.appId || nativeConfig.webDir !== config.webDir || nativeConfig.server?.url || nativeConfig.server?.allowNavigation) {
    throw new Error('native Capacitor configuration drift');
  }
}

for (const required of ['index.html', 'sim.js', 'seatlog.js', 'packs/olive_drive.json', 'vendor/three.module.js', 'privacy.html', 'terms.html', 'credits.html', 'unsupported.html']) {
  if (!manifest.files.some(file => file.path === required)) throw new Error(`required release file missing: ${required}`);
}

const index = await readFile(join(webRoot, 'index.html'), 'utf8');
if (/fonts\.googleapis\.com|cdn\.jsdelivr\.net|\/uplandskin\//.test(index)) {
  throw new Error('release index contains an unpinned executable, font, or asset dependency');
}
if (/<script\b[^>]*\bsrc=["'](?:https?:)?\/\/|<link\b(?=[^>]*\brel=["']stylesheet["'])(?=[^>]*\bhref=["'](?:https?:)?\/\/)/i.test(index)) {
  throw new Error('release index contains a remote executable or stylesheet');
}
for (const directive of ['Content-Security-Policy', "object-src 'none'", "base-uri 'none'"]) {
  if (!index.includes(directive)) throw new Error(`release CSP is missing ${directive}`);
}

const info = await readFile(join(root, 'ios/App/App/Info.plist'), 'utf8');
const privacy = await readFile(join(root, 'ios/App/App/PrivacyInfo.xcprivacy'), 'utf8');
const project = await readFile(join(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
if (!info.includes('UIDesignRequiresCompatibility') || !info.includes('ITSAppUsesNonExemptEncryption') || !info.includes('UIRequiresFullScreen') || !info.includes('<string>e5circuit</string>')) throw new Error('iOS release metadata is incomplete');
if (!privacy.includes('NSPrivacyTracking') || !project.includes('PrivacyInfo.xcprivacy in Resources')) throw new Error('iOS privacy manifest is not bundled');
if (!project.includes('PRODUCT_BUNDLE_IDENTIFIER = com.e5enclave.streetcircuit;') || !project.includes('IPHONEOS_DEPLOYMENT_TARGET = 15.0;')) throw new Error('iOS project identity or deployment target drift');

console.log(`verified ${manifest.releaseId.slice(0, 12)} · ${manifest.files.length} files · immutable bundle${VERIFY_NATIVE_BUNDLE ? ' · native copy exact' : ''}`);
