// Finds playwright-core without adding it to package.json. Order: $PLAYWRIGHT_CORE,
// a local install, then the copy bundled with the Playwright MCP server that Claude
// Code installs globally (%APPDATA%/npm/node_modules/@playwright/mcp). Browsers are
// launched with channel 'msedge', so no Playwright browser download is needed on Windows.
const path = require('path');

const candidates = [
  process.env.PLAYWRIGHT_CORE,
  'playwright-core',
  path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@playwright', 'mcp', 'node_modules', 'playwright-core'),
].filter(Boolean);

for (const c of candidates) {
  try { module.exports = require(c); return; } catch (e) { /* next */ }
}
throw new Error('playwright-core not found. Run `npm i -D playwright-core` or set PLAYWRIGHT_CORE to its folder.');
