import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// No network or dependency installation: use the lockfiles and local sources only.
const appRoot = path.resolve(import.meta.dirname, '..');
const target = 'x86_64-pc-windows-msvc';
const outputName = 'THIRD_PARTY_NOTICES.txt';
const noticeName = /^(?:LICEN[CS]E|COPYING|COPYRIGHT|NOTICE)/i;
const licenseName = /^(?:LICEN[CS]E|COPYING)/i;
const creditName = /^(?:COPYRIGHT|NOTICE)/i;
const maxTextBytes = 2 * 1024 * 1024;
const records = new Map();
const supplementsRoot = path.join(appRoot, 'third-party', 'licenses');
const supplements = new Map();
const usedSupplements = new Set();
let excludedOptional = 0;
let skippedBinary = 0;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const slash = (value) => value.split(path.sep).join('/');

class GenerationError extends Error {}

function fail(message) {
  throw new GenerationError(message);
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fail(`Cannot read or parse required ${label}.`);
  }
}

function stat(file, label) {
  try {
    return fs.statSync(file);
  } catch {
    fail(`Missing or unreadable required ${label}.`);
  }
}

function entries(dir, label) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name));
  } catch {
    fail(`Cannot enumerate required ${label}.`);
  }
}

function contained(root, candidate) {
  const rel = path.relative(root, candidate);
  return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

function safeRelative(value) {
  return typeof value === 'string' && value.length > 0 &&
    !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value) &&
    !/^[a-z]:/i.test(value) && !value.includes('\\') &&
    value.split('/').every((part) => part && part !== '.' && part !== '..');
}

function identity(name, version, ecosystem) {
  const pattern = ecosystem === 'npm'
    ? /^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i
    : /^[a-z0-9_-]+$/i;
  if (typeof name !== 'string' || !pattern.test(name) ||
      typeof version !== 'string' || !/^[a-z0-9.+_-]+$/i.test(version)) {
    fail(`Invalid ${ecosystem} package identity; refusing unsafe output.`);
  }
  return `${ecosystem}: ${name}@${version}`;
}

function declaredLicense(manifest) {
  const value = manifest.license ?? manifest.licenses;
  const type = (item) => typeof item === 'string' ? item : item?.type;
  const values = (Array.isArray(value) ? value.map(type) : [type(value)])
    .filter((item) => typeof item === 'string' && item.trim());
  return [...new Set(values.map((item) => item.trim()))].sort(compare).join(' OR ') || 'NOT DECLARED';
}

// Refuse machine paths instead of redacting legal text (which could alter notices).
function assertPortable(text, label) {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) ||
      /\b[a-z]:[\\/]/i.test(text) || /\\\\[^\s\\]+\\/.test(text) ||
      /(^|[\s"'(=])\/[a-z0-9_.~-]+(?:\/|(?=[\s"'(),;:]|$))/im.test(text)) {
    fail(`Unsafe absolute path or control character in ${label}; output was not written.`);
  }
  for (const prefix of [appRoot, process.env.USERPROFILE, process.env.HOME, process.env.LOCALAPPDATA]) {
    if (!prefix || prefix.length < 4) continue;
    for (const form of [prefix, prefix.replaceAll('\\', '/')]) {
      if (text.toLowerCase().includes(form.toLowerCase())) {
        fail(`Machine-specific path in ${label}; output was not written.`);
      }
    }
  }
}

function readNotice(file, label, required) {
  const info = stat(file, label);
  if (!info.isFile() || info.size > maxTextBytes) {
    fail(`Expected a regular text file of at most ${maxTextBytes} bytes for ${label}.`);
  }
  let buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch {
    fail(`Cannot read required ${label}.`);
  }
  let text;
  try {
    const encoding = buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf-16le'
      : buffer[0] === 0xfe && buffer[1] === 0xff ? 'utf-16be' : 'utf-8';
    text = new TextDecoder(encoding, { fatal: true }).decode(buffer);
  } catch {
    if (required) fail(`Required ${label} is not valid UTF-8/UTF-16 text.`);
    skippedBinary++;
    return null;
  }
  if (/[\u0000-\u0008\u000b\u000e-\u001f]/.test(text)) {
    if (required) fail(`Required ${label} appears to be binary.`);
    skippedBinary++;
    return null;
  }
  // Preserve attribution and wording, normalizing only BOM/newlines/trailing whitespace.
  text = normalizeText(text);
  if (!text.trim()) fail(`Empty required ${label}.`);
  assertPortable(text, label);
  return text;
}

function notices(root, references, label) {
  const found = new Map();
  let visited = 0;
  let realRoot;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    fail(`Missing source directory for ${label}.`);
  }
  function visit(file, isLicense, required, depth = 0) {
    if (depth > 12 || ++visited > 2000) fail(`License directory exceeds safety limits for ${label}.`);
    const relative = slash(path.relative(root, file));
    if (!safeRelative(relative)) fail(`Unsafe license reference for ${label}.`);
    let real;
    try {
      real = fs.realpathSync(file);
    } catch {
      fail(`Missing required license/notice file for ${label}.`);
    }
    if (!contained(realRoot, real)) fail(`License reference escapes package source for ${label}.`);
    const info = stat(file, `${label} license/notice`);
    if (info.isDirectory()) {
      for (const entry of entries(file, `${label} license directory`)) {
        visit(path.join(file, entry.name), isLicense && !creditName.test(entry.name), required, depth + 1);
      }
      return;
    }
    const previous = found.get(relative);
    if (previous) {
      previous.isLicense ||= isLicense;
      return;
    }
    const text = readNotice(file, `${label} license/notice`, required);
    if (text !== null) found.set(relative, { relative, text, isLicense });
  }
  for (const entry of entries(root, `${label} source directory`)) {
    if (noticeName.test(entry.name)) {
      visit(path.join(root, entry.name), licenseName.test(entry.name), false);
    }
  }
  for (const reference of references) {
    if (typeof reference !== 'string' || !reference.trim()) fail(`Invalid license_file for ${label}.`);
    // Cargo may expose an absolute license_file, but only package-relative labels are emitted.
    const file = path.resolve(root, reference);
    if (!contained(root, file)) fail(`license_file escapes package source for ${label}.`);
    if (!stat(file, `${label} license_file`).isFile()) fail(`license_file is not a regular file for ${label}.`);
    visit(file, true, true);
  }
  return [...found.values()].sort((a, b) => compare(a.relative, b.relative));
}

function normalizeText(text) {
  return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trimEnd();
}

function requiredWithin(root, relative, label) {
  if (!safeRelative(relative)) fail(`Unsafe relative file reference for ${label}.`);
  const file = path.join(root, relative);
  let realRoot;
  let realFile;
  try {
    realRoot = fs.realpathSync(root);
    realFile = fs.realpathSync(file);
  } catch {
    fail(`Missing required file for ${label}.`);
  }
  if (!contained(realRoot, realFile) || !stat(file, label).isFile()) {
    fail(`Required file escapes its source directory or is not a regular file for ${label}.`);
  }
  return file;
}

function repositoryUrl(manifest) {
  const value = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
  return typeof value === 'string'
    ? value.replace(/^git\+/, '').replace(/\.git\/?$/, '').replace(/\/$/, '').toLowerCase() : '';
}

function publicUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      ['github.com', 'api.github.com', 'raw.githubusercontent.com', 'registry.npmjs.org',
        'crates.io', 'static.crates.io', 'mozilla.org', 'www.mozilla.org'].includes(url.hostname);
  } catch {
    return false;
  }
}

function extractCached(text, file, label) {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (file.fromMarker) {
    const start = normalized.indexOf(file.fromMarker);
    if (start < 0) fail(`Cached attribution marker is missing for ${label}.`);
    return normalizeText(normalized.slice(start));
  }
  const lines = normalized.split('\n');
  if (!Number.isInteger(file.lineStart) || !Number.isInteger(file.lineEnd) ||
      file.lineStart < 1 || file.lineEnd < file.lineStart || file.lineEnd > lines.length) {
    fail(`Invalid cached license header range for ${label}.`);
  }
  return normalizeText(lines.slice(file.lineStart - 1, file.lineEnd).join('\n'));
}

function loadSupplements() {
  const sourceFile = requiredWithin(supplementsRoot, 'SOURCE.json', 'license provenance SOURCE.json');
  const source = readJson(sourceFile, 'license provenance SOURCE.json');
  assertPortable(JSON.stringify(source), 'license provenance SOURCE.json');
  if (source.schemaVersion !== 1 || !Array.isArray(source.packages)) {
    fail('Unsupported third-party license provenance schema.');
  }
  for (const supplement of source.packages) {
    if (!['npm', 'cargo'].includes(supplement.ecosystem)) fail('Invalid supplement ecosystem.');
    const key = identity(supplement.name, supplement.version, supplement.ecosystem);
    if (supplements.has(key) || typeof supplement.declaredLicense !== 'string' ||
        typeof supplement.notes !== 'string' || !publicUrl(supplement.repository) ||
        !Array.isArray(supplement.files) || !supplement.files.length ||
        !Array.isArray(supplement.evidenceUrls) || !supplement.evidenceUrls.length ||
        !supplement.evidenceUrls.every(publicUrl) ||
        (supplement.sourceCodeUrls && (!Array.isArray(supplement.sourceCodeUrls) ||
          !supplement.sourceCodeUrls.every(publicUrl)))) {
      fail(`Invalid or duplicate license supplement for ${key}.`);
    }
    const items = [];
    for (const file of supplement.files) {
      if (!['license', 'notice'].includes(file.kind) || !publicUrl(file.url) ||
          !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isInteger(file.bytes) ||
          file.bytes < 1 || file.bytes > maxTextBytes) {
        fail(`Invalid license file provenance for ${key}.`);
      }
      const local = requiredWithin(supplementsRoot, file.file, `${key} saved license/notice`);
      if (stat(local, `${key} saved license/notice`).size !== file.bytes) {
        fail(`Saved license/notice byte count mismatch for ${key}.`);
      }
      let digest;
      try {
        digest = createHash('sha256').update(fs.readFileSync(local)).digest('hex');
      } catch {
        fail(`Cannot verify saved license/notice for ${key}.`);
      }
      if (digest !== file.sha256) fail(`Saved license/notice SHA-256 mismatch for ${key}.`);
      items.push({ relative: `third-party/licenses/${file.file}`, isLicense: file.kind === 'license',
        text: readNotice(local, `${key} saved license/notice`, true), descriptor: file });
    }
    if (!items.some((item) => item.isLicense)) fail(`Supplement has no full license text for ${key}.`);
    supplements.set(key, { ...supplement, items });
  }
}

function supplementalNotices(manifest, root, key) {
  const supplement = supplements.get(key);
  if (!supplement) return [];
  if (supplement.declaredLicense !== declaredLicense(manifest) ||
      repositoryUrl(manifest) !== supplement.repository.toLowerCase()) {
    fail(`Saved license supplement no longer matches declared license/repository for ${key}.`);
  }
  if (supplement.cachedRevision) {
    const vcsFile = requiredWithin(root, '.cargo_vcs_info.json', `${key} cached VCS metadata`);
    const vcs = readJson(vcsFile, `${key} cached VCS metadata`);
    if (vcs.git?.sha1 !== supplement.cachedRevision) fail(`Cached source revision mismatch for ${key}.`);
  }
  let wrapperRoot;
  if (supplement.wrapper) {
    const wrapper = supplement.wrapper;
    const file = requiredWithin(appRoot, `${wrapper.packagePath}/package.json`, `${key} wrapper manifest`);
    wrapperRoot = path.dirname(file);
    const pkg = readJson(file, `${key} wrapper manifest`);
    if (pkg.name !== wrapper.name || pkg.version !== wrapper.version || pkg.version !== manifest.version ||
        declaredLicense(pkg) !== supplement.declaredLicense || repositoryUrl(pkg) !== repositoryUrl(manifest)) {
      fail(`Installed monorepo wrapper does not match the binding for ${key}.`);
    }
  }
  for (const item of supplement.items) {
    const descriptor = item.descriptor;
    if (descriptor.cachedFile) {
      const file = requiredWithin(root, descriptor.cachedFile, `${key} cached attribution source`);
      let cached;
      try {
        cached = fs.readFileSync(file, 'utf8');
      } catch {
        fail(`Cannot read cached attribution source for ${key}.`);
      }
      if (extractCached(cached, descriptor, key) !== item.text) {
        fail(`Saved attribution differs from the cached source for ${key}.`);
      }
    }
    if (descriptor.wrapperFile) {
      if (!wrapperRoot) fail(`Missing wrapper verification metadata for ${key}.`);
      const file = requiredWithin(wrapperRoot, descriptor.wrapperFile, `${key} wrapper license`);
      if (readNotice(file, `${key} wrapper license`, true) !== item.text) {
        fail(`Saved license differs from the installed monorepo wrapper for ${key}.`);
      }
    }
  }
  usedSupplements.add(key);
  return supplement.items;
}

function addPackage(ecosystem, manifest, root, scope, references = []) {
  const key = identity(manifest.name, manifest.version, ecosystem);
  const license = declaredLicense(manifest);
  assertPortable(license, `${key} license metadata`);
  if (/[\r\n]/.test(license)) fail(`Multiline license metadata for ${key}.`);
  let record = records.get(key);
  if (!record) {
    record = { key, ecosystem, license, scopes: new Set(), texts: new Map(), hasLicense: false };
    records.set(key, record);
  } else if (record.license !== license) {
    fail(`Conflicting license metadata for ${key}.`);
  }
  record.scopes.add(scope);
  const supplemental = supplementalNotices(manifest, root, key);
  record.supplement = supplements.get(key);
  for (const item of [...notices(root, references, key), ...supplemental]) {
    record.hasLicense ||= item.isLicense;
    // Deduplicate only inside a package/version, never across different copyright holders.
    if (!record.texts.has(item.text)) record.texts.set(item.text, new Set());
    record.texts.get(item.text).add(item.relative);
  }
}

function matchesPlatform(values, current) {
  return !Array.isArray(values) ||
    (!values.includes(`!${current}`) &&
      (!values.some((value) => !value.startsWith('!') && value !== 'any') ||
        values.includes(current) || values.includes('any')));
}

function collectNpm() {
  const project = readJson(path.join(appRoot, 'package.json'), 'frontend package.json');
  const lock = readJson(path.join(appRoot, 'package-lock.json'), 'package-lock.json');
  if (![2, 3].includes(lock.lockfileVersion) || !lock.packages?.[''] ||
      lock.packages[''].name !== project.name || lock.packages[''].version !== project.version) {
    fail('Unsupported or inconsistent npm lockfile; expected package-lock v2/v3 matching the project.');
  }
  stat(path.join(appRoot, 'node_modules'), 'node_modules directory');
  const installed = new Set();
  for (const [location, locked] of Object.entries(lock.packages).sort(([a], [b]) => compare(a, b))) {
    if (!location) continue;
    if (!safeRelative(location) || !location.startsWith('node_modules/') || locked.link) {
      fail('Unsupported npm package location/link in lockfile.');
    }
    const root = path.join(appRoot, location);
    if (!fs.existsSync(root)) {
      if (locked.optional &&
          (!matchesPlatform(locked.os, 'win32') || !matchesPlatform(locked.cpu, 'x64'))) {
        excludedOptional++;
        continue;
      }
      fail(`Missing required installed npm package: ${location}.`);
    }
    const manifest = readJson(path.join(root, 'package.json'), `${location}/package.json`);
    const expectedName = locked.name ?? location.slice(location.lastIndexOf('node_modules/') + 13);
    if (manifest.version !== locked.version || manifest.name !== expectedName) {
      fail(`Installed npm package does not match lockfile: ${location}.`);
    }
    installed.add(location);
    const refs = [manifest.license_file, manifest.licenseFile].filter((value) => value != null);
    if (typeof manifest.license === 'string') {
      const match = /^SEE LICEN[CS]E IN\s+(.+)$/i.exec(manifest.license.trim());
      if (match) refs.push(match[1]);
    }
    addPackage('npm', manifest, root, locked.dev ? 'buildtool (npm dev dependency)'
      : 'frontend dependency (may also be used during build)', refs);
  }
  // Do not silently omit installed packages that are absent from the lockfile.
  function checkModules(dir) {
    for (const entry of entries(dir, 'node_modules directory')) {
      if (entry.name.startsWith('.')) continue;
      const candidate = path.join(dir, entry.name);
      const roots = entry.name.startsWith('@')
        ? entries(candidate, 'npm scope directory').map((child) => path.join(candidate, child.name))
        : [candidate];
      for (const root of roots) {
        const relative = slash(path.relative(appRoot, root));
        if (!installed.has(relative)) fail('Installed npm package is not represented by the lockfile.');
        const nested = path.join(root, 'node_modules');
        if (fs.existsSync(nested)) checkModules(nested);
      }
    }
  }
  checkModules(path.join(appRoot, 'node_modules'));
}

function collectCargo() {
  stat(path.join(appRoot, 'src-tauri', 'Cargo.toml'), 'src-tauri/Cargo.toml');
  stat(path.join(appRoot, 'src-tauri', 'Cargo.lock'), 'src-tauri/Cargo.lock');
  const result = spawnSync('cargo', [
    'metadata', '--offline', '--locked', '--format-version', '1',
    '--filter-platform', target, '--manifest-path', 'src-tauri/Cargo.toml',
  ], { cwd: appRoot, encoding: 'utf8', timeout: 60000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) {
    // Cargo stderr can contain private cache/manifests paths: never echo it into the notices/log.
    const reason = result.error?.code === 'ETIMEDOUT' ? 'timed out after 60s'
      : result.error?.code === 'ENOENT' ? 'cargo is unavailable' : `exit status ${result.status}`;
    fail(`Offline locked Cargo metadata failed (${reason}); verify the local cache and lockfile.`);
  }
  let metadata;
  try {
    metadata = JSON.parse(result.stdout);
  } catch {
    fail('Cargo returned invalid metadata JSON.');
  }
  if (!Array.isArray(metadata.packages) || !Array.isArray(metadata.workspace_members) ||
      !Array.isArray(metadata.resolve?.nodes)) fail('Cargo metadata is missing the resolved package graph.');
  const workspace = new Set(metadata.workspace_members);
  const resolved = new Set(metadata.resolve.nodes.map((node) => node.id));
  const known = new Set(metadata.packages.map((pkg) => pkg.id));
  if ([...resolved].some((id) => !known.has(id))) fail('Cargo metadata has unresolved package records.');
  for (const pkg of metadata.packages) {
    if (workspace.has(pkg.id) || !resolved.has(pkg.id)) continue;
    if (typeof pkg.manifest_path !== 'string') fail('Cargo package has no source manifest.');
    stat(pkg.manifest_path, 'cached Cargo package manifest');
    addPackage('cargo', pkg, path.dirname(pkg.manifest_path),
      'Windows Cargo dependency (conservatively includes build/dev dependencies)',
      pkg.license_file == null ? [] : [pkg.license_file]);
  }
}

function generate() {
  loadSupplements();
  collectNpm();
  collectCargo();
  const packages = [...records.values()].sort((a, b) => compare(a.key, b.key));
  if (!packages.length) fail('No third-party packages found; refusing to write an empty inventory.');
  const omissions = packages.filter((pkg) => !pkg.hasLicense);
  const npmCount = packages.filter((pkg) => pkg.ecosystem === 'npm').length;
  const cargoCount = packages.length - npmCount;
  const lines = [
    'THIRD-PARTY NOTICES',
    '===================',
    '',
    'The license for Meyaj itself DOES NOT replace, override, or relicense any',
    'third-party component. Third-party components retain their own licenses,',
    'copyright notices, attribution requirements, and other applicable obligations.',
    'Any PolyForm Noncommercial license applied to Meyaj itself applies only to the',
    "project's own code, not as a replacement for third-party licenses.",
    '',
    `Target: ${target}`,
    'Sources: installed npm packages matched to package-lock.json, and locally',
    'cached crate sources from offline, locked Cargo metadata for the target.',
    'Version-scoped upstream supplements: third-party/licenses/SOURCE.json.',
    'Saved supplemental texts are verified offline using SHA-256; their original',
    'URLs, provenance limitations, and source availability information follow.',
    'Scope intentionally includes build tools and Cargo build/dev dependencies;',
    'presence here does not prove that a package is shipped in the executable.',
    'License declarations are upstream metadata, not an independent SPDX audit.',
    'Installed-source labels are relative to each package root; labels beginning',
    'third-party/licenses/ are relative to the application root.',
    'Identical text is deduplicated only within the same ecosystem/name/version.',
    '',
    `Packages: ${packages.length} (npm: ${npmCount}; Cargo: ${cargoCount})`,
    `Absent optional npm packages for other platforms excluded: ${excludedOptional}`,
    `Non-text files skipped in automatically discovered notice directories: ${skippedBinary}`,
    `Packages supplemented with verified upstream texts: ${usedSupplements.size}`,
    `Packages without installed or supplemental full license text: ${omissions.length}`,
    `Release blockers from missing license texts: ${omissions.length}`,
    '',
    'FOLLOW-UP: MISSING LICENSE TEXTS',
    '===============================',
    'A declared license expression alone is not a copied license text or evidence',
    'of permission. No substitute license or authorization has been invented.',
    'For each omission, obtain the applicable upstream text and verify all release',
    'obligations before distribution. Other notices, if present, are retained below.',
    ...(omissions.length ? omissions.map((pkg) => `${pkg.key} | Declared license: ${pkg.license}`) : ['None.']),
    '',
  ];
  for (const pkg of packages) {
    lines.push('='.repeat(78), pkg.key, `Scope: ${[...pkg.scopes].sort(compare).join('; ')}`,
      `Declared license: ${pkg.license}`);
    if (pkg.supplement) {
      const source = pkg.supplement;
      lines.push('Provenance: third-party/licenses/SOURCE.json', `Upstream repository: ${source.repository}`,
        `Provenance note: ${source.notes}`, ...source.evidenceUrls.map((url) => `Evidence: ${url}`));
      if (source.sourceCodeUrls) {
        lines.push('', `Upstream Source Code Form for ${source.name} ${source.version} (${source.declaredLicense}):`,
          ...source.sourceCodeUrls,
          'If modified Covered Software is distributed, its corresponding modified',
          'Source Code Form must also be made available under the applicable license.');
      }
    }
    if (!pkg.hasLicense) {
      lines.push('MISSING LICENSE TEXT: metadata only for the license; follow-up required.');
    }
    if (!pkg.texts.size) lines.push('No local license, copyright, or notice text was found.');
    const groups = [...pkg.texts].map(([text, files]) => ({ text, files: [...files].sort(compare) }))
      .sort((a, b) => compare(a.files.join('\n'), b.files.join('\n')));
    for (const group of groups) {
      lines.push('', `--- ${group.files.join(', ')} ---`);
      for (const file of group.files) {
        const item = pkg.supplement?.items.find((candidate) => candidate.relative === file);
        if (item) lines.push(`Source: ${item.descriptor.url}`, `Saved file SHA-256: ${item.descriptor.sha256}`);
      }
      lines.push(group.text);
    }
    lines.push('');
  }
  const output = `${lines.join('\n').trimEnd()}\n`;
  assertPortable(output, 'generated notices');
  // All reads/validation finish before touching the previous generated output.
  fs.writeFileSync(path.join(appRoot, outputName), output, 'utf8');
  console.log(`Packages: ${packages.length} (npm: ${npmCount}; Cargo: ${cargoCount})`);
  console.log(`Without LICENSE text: ${omissions.length}`);
  for (const pkg of omissions) console.log(`  ${pkg.key} | ${pkg.license}`);
  console.log(`Excluded optional npm packages for other platforms: ${excludedOptional}`);
  console.log(`Non-text notice files skipped: ${skippedBinary}`);
  console.log(`Packages supplemented with verified upstream texts: ${usedSupplements.size}`);
  console.log(`Release blockers from missing license texts: ${omissions.length}`);
  console.log(`${outputName}: ${Buffer.byteLength(output, 'utf8')} bytes`);
  if (omissions.length) process.exitCode = 1;
}

try {
  generate();
} catch (error) {
  // Native filesystem/process errors can expose absolute paths; only emit our own diagnostics.
  console.error(error instanceof GenerationError ? error.message : 'Generation failed; check local source files and permissions.');
  process.exitCode = 1;
}
