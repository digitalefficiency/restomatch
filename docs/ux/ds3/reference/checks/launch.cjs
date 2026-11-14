// How the checks start a browser. The repository pins its own Playwright, whose browser may not be installed in
// a cloud session; such sessions ship a Chromium at /opt/pw-browsers/chromium. CHROMIUM_PATH overrides it.
const fs = require('fs');
const path = require('path');
module.exports = function launchOptions() {
  const o = {};
  if (process.env.HTTPS_PROXY) o.proxy = { server: process.env.HTTPS_PROXY };
  const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  try { if (fs.statSync(exe).isFile()) o.executablePath = exe; } catch (e) { /* use Playwright's own browser */ }
  return o;
};
// Where the checks keep their working copies and screenshots: an `out` folder beside the scripts, which the
// repository's .gitignore already ignores. Not the system's shared temporary folder, where another user of the
// machine could read or replace a file with a known name.
module.exports.outDir = function outDir() {
  const dir = path.join(__dirname, 'out');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};
