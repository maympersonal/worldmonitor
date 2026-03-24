import { promises as fs } from 'node:fs';
import path from 'node:path';

const distDir = path.resolve(process.cwd(), 'dist');

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return walk(absolute);
    }
    return [absolute];
  }));

  return files.flat();
}

function toRel(file) {
  return path.relative(distDir, file).split(path.sep).join('/');
}

async function main() {
  try {
    await fs.access(distDir);
  } catch {
    console.error('[verify-desktop-no-pwa] Missing dist/ folder. Run a desktop Vite build first.');
    process.exit(1);
  }

  const absoluteFiles = await walk(distDir);
  const files = absoluteFiles.map(toRel);

  const forbiddenPatterns = [
    /^manifest\.webmanifest$/,
    /^sw\.js$/,
    /^workbox-.*\.js$/,
    /^assets\/virtual_pwa-register-.*\.js$/,
    /^assets\/workbox-window\..*\.js$/,
  ];

  const hits = files.filter((file) => forbiddenPatterns.some((pattern) => pattern.test(file)));

  const htmlChecks = ['index.html', 'settings.html'];
  for (const htmlFile of htmlChecks) {
    const target = path.join(distDir, htmlFile);
    try {
      const content = await fs.readFile(target, 'utf8');
      if (content.includes('manifest.webmanifest') || content.includes('virtual_pwa-register')) {
        hits.push(htmlFile);
      }
    } catch {
      // Optional output files depending on build input; ignore if missing.
    }
  }

  if (hits.length > 0) {
    console.error('[verify-desktop-no-pwa] Desktop build contains forbidden PWA artifacts:');
    for (const file of [...new Set(hits)].sort()) {
      console.error(` - ${file}`);
    }
    process.exit(1);
  }

  console.log('[verify-desktop-no-pwa] OK: desktop build has no PWA artifacts.');
}

main().catch((error) => {
  console.error('[verify-desktop-no-pwa] Unexpected error:', error);
  process.exit(1);
});
