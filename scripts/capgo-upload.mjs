import { spawnSync } from 'node:child_process';

const apiKey = process.env.CAPGO_API_KEY;
const appId = process.env.CAPGO_APP_ID;
const channel = process.env.CAPGO_CHANNEL || 'production';

const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

if (!apiKey) {
  console.error('Missing CAPGO_API_KEY');
  process.exit(1);
}

if (!appId) {
  console.error('Missing CAPGO_APP_ID');
  process.exit(1);
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

run(npmCmd, ['--prefix', 'web', 'run', 'build']);
run(npxCmd, [
  '@capgo/cli@latest',
  'bundle',
  'upload',
  appId,
  '-a',
  apiKey,
  '-p',
  'web/dist',
  '-c',
  channel,
  '--delta',
]);
