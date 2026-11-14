// How the checks start a browser. The repository pins its own Playwright, whose browser may not be installed in
// a cloud session; such sessions ship a Chromium at /opt/pw-browsers/chromium. CHROMIUM_PATH overrides it.
const fs = require('fs');
module.exports = function launchOptions() {
  const o = {};
  if (process.env.HTTPS_PROXY) o.proxy = { server: process.env.HTTPS_PROXY };
  const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
  try { if (fs.statSync(exe).isFile()) o.executablePath = exe; } catch (e) { /* use Playwright's own browser */ }
  return o;
};
