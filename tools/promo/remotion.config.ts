import { Config } from '@remotion/cli/config';

// Use the container's preinstalled headless Chromium instead of downloading one.
Config.setBrowserExecutable(
  process.env.REMOTION_BROWSER ?? '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
);
Config.setVideoImageFormat('png');
Config.setCodec('h264');
