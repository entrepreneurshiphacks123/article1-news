// Article I — brand-asset renderer.
//
// Generates the iOS app icon, Android PWA icons, and the homepage social
// card (og-default.png) by rendering self-contained HTML via headless Chrome.
//
// Run via:  npm run icons
//
// Output:
//   public/apple-touch-icon.png  (180×180, no transparency, full-bleed)
//   public/icon-192.png          (192×192, Android home/PWA)
//   public/icon-512.png          (512×512, Android maskable safe-zone)
//   public/og-default.png        (1200×630, social card for non-post pages)
//
// This is a one-off renderer — re-run only when the brand changes. The
// outputs are committed to public/ so Cloudflare Pages serves them directly.

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SITE_ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(SITE_ROOT, 'public');
const RENDER_DIR = path.join(SITE_ROOT, '.icons-render');     // gitignored scratch
const CHROME_SCRATCH = path.join(SITE_ROOT, '.og-chrome-scratch');

const CHROME_TIMEOUT_MS = 30_000;

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
async function findChrome(): Promise<string> {
  for (const p of CHROME_CANDIDATES) {
    try { await fs.access(p); return p; } catch {}
  }
  throw new Error(`No Chrome binary found in ${CHROME_CANDIDATES.join(', ')}`);
}

// Square app icon: parchment full-bleed, big italic red "I" centered.
// We use Source Serif 4 from Google Fonts (loaded over HTTPS at render
// time) for typographic fidelity with the rest of the brand. Webfonts
// resolve before screenshot because Chrome's --virtual-time-budget waits.
const APP_ICON_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@1,8..60,700;1,8..60,900&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; padding: 0; height: 100vh; background: #FAFAF7; }
  body { display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .I {
    font-family: 'Source Serif 4', Georgia, 'Times New Roman', serif;
    font-style: italic;
    font-weight: 900;
    color: #9B1C1C;
    /* 78vmin keeps the glyph inside the Android maskable safe zone (80%)
       and still feels confident at 60×60 on iOS. */
    font-size: 78vmin;
    line-height: 1;
    /* Pull up slightly to optically center the serif italic — italic
       letters render with bottom whitespace from descender slot. */
    transform: translateY(-2%);
  }
</style>
</head>
<body><span class="I">I</span></body>
</html>`;

const OG_DEFAULT_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,700;1,8..60,700&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; padding: 0; }
  body {
    width: 1200px; height: 630px; box-sizing: border-box;
    background: #FAFAF7;
    font-family: 'Source Serif 4', Georgia, 'Times New Roman', serif;
    color: #1A1A1A;
    padding: 64px 80px;
    display: flex; flex-direction: column; justify-content: center;
  }
  /* Newspaper-style double rule at the top. */
  .rule {
    height: 6px;
    border-top: 1.5px solid #1A1A1A;
    border-bottom: 1.5px solid #1A1A1A;
    margin-bottom: 96px;
  }
  .word {
    font-size: 168px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 0.98;
  }
  .word .I {
    font-style: italic;
    color: #9B1C1C;
    margin-left: 6px;
  }
  .tagline {
    font-style: italic;
    font-size: 34px;
    line-height: 1.35;
    color: #4A4A4A;
    max-width: 880px;
    margin-top: 36px;
  }
</style>
</head>
<body>
<div class="rule"></div>
<div class="word">Article<span class="I">I</span></div>
<div class="tagline">American politics through the lens of the Constitution and the long memory.</div>
</body>
</html>`;

async function chromeShot(chrome: string, url: string, outFile: string, w: number, h: number): Promise<void> {
  await fs.mkdir(CHROME_SCRATCH, { recursive: true });
  const tmp = await fs.mkdtemp(path.join(CHROME_SCRATCH, 'chrome-'));
  try {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(chrome, [
        '--headless=new',
        '--hide-scrollbars',
        '--disable-gpu',
        '--no-sandbox',
        `--user-data-dir=${tmp}`,
        `--window-size=${w},${h}`,
        `--screenshot=${outFile}`,
        '--virtual-time-budget=4000', // longer than og-stories — give webfont CSS time to land
        url,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      const timer = setTimeout(async () => {
        try { proc.kill('SIGKILL'); } catch {}
        try {
          const stat = await fs.stat(outFile);
          if (stat.size > 0) return resolve();
        } catch {}
        reject(new Error(`Chrome timed out after ${CHROME_TIMEOUT_MS}ms`));
      }, CHROME_TIMEOUT_MS);
      proc.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) return resolve();
        fs.stat(outFile).then((s) => {
          if (s.size > 0) resolve();
          else reject(new Error(`Chrome exited ${code}: ${stderr.split('\n').slice(-3).join(' | ')}`));
        }).catch(() => reject(new Error(`Chrome exited ${code}: ${stderr.split('\n').slice(-3).join(' | ')}`)));
      });
      proc.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
  } finally {
    fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

function startStaticServer(dir: string, port: number): Promise<{ stop: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
        const file = path.join(dir, reqPath === '/' ? 'index.html' : reqPath);
        const data = await fs.readFile(file);
        res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404); res.end();
      }
    });
    server.listen(port, '127.0.0.1', () => {
      resolve({ stop: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

async function main() {
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  await fs.mkdir(RENDER_DIR, { recursive: true });

  const chrome = await findChrome();
  console.log(`Using Chrome: ${chrome}`);

  // Write the per-asset HTML files into the scratch dir so Chrome can fetch
  // them over a real http:// URL — webfonts via @import / <link> only resolve
  // reliably from http:// origins (some Chrome versions block fonts on file://).
  await fs.writeFile(path.join(RENDER_DIR, 'app-icon.html'), APP_ICON_HTML);
  await fs.writeFile(path.join(RENDER_DIR, 'og-default.html'), OG_DEFAULT_HTML);

  const server = await startStaticServer(RENDER_DIR, 8767);
  try {
    // Render the app icon ONCE at 1024×1024 (oversample for crispness).
    // Smaller viewports (180/192) blank out because the webfont hasn't
    // finished loading on the first paint — rendering big and downscaling
    // via macOS `sips` is more reliable AND produces sharper edges than
    // letting Chrome render natively at 180px.
    const masterIcon = path.join(RENDER_DIR, 'icon-master.png');
    console.log('  → master app icon (1024×1024)');
    await chromeShot(chrome, 'http://127.0.0.1:8767/app-icon.html', masterIcon, 1024, 1024);
    const masterStat = await fs.stat(masterIcon);
    console.log(`    ${masterStat.size} bytes`);

    const iconSizes = [
      { name: 'apple-touch-icon.png', size: 180 },
      { name: 'icon-192.png',         size: 192 },
      { name: 'icon-512.png',         size: 512 },
    ];
    for (const t of iconSizes) {
      const out = path.join(PUBLIC_DIR, t.name);
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('/usr/bin/sips', ['-z', String(t.size), String(t.size), masterIcon, '--out', out], { stdio: ['ignore', 'ignore', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`sips exited ${code}: ${stderr}`)));
      });
      const stat = await fs.stat(out);
      console.log(`  → ${t.name} (${t.size}×${t.size}) ${stat.size} bytes`);
    }

    // og-default is rendered at its native target size — webfont reliably
    // loads at this viewport and downscaling a 1200×630 social card adds
    // no value (the destination IS 1200×630).
    const ogOut = path.join(PUBLIC_DIR, 'og-default.png');
    console.log('  → og-default.png (1200×630)');
    await chromeShot(chrome, 'http://127.0.0.1:8767/og-default.html', ogOut, 1200, 630);
    const ogStat = await fs.stat(ogOut);
    console.log(`    ${ogStat.size} bytes`);
  } finally {
    await server.stop();
    await fs.rm(RENDER_DIR, { recursive: true, force: true }).catch(() => {});
    await fs.rm(CHROME_SCRATCH, { recursive: true, force: true }).catch(() => {});
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error('icons renderer crashed:', err);
  process.exit(1);
});
