import * as core from '@actions/core';
import { waitForExit } from './lib';

async function run(): Promise<void> {
  const pidStr = core.getState('pid');
  if (!pidStr) {
    core.info('No tunnel PID found — nothing to stop');
    return;
  }

  const pid = parseInt(pidStr, 10);
  core.info(`Stopping ig-iap-tunnel (PID ${pid})`);

  try {
    process.kill(pid, 'SIGTERM');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
      core.info('ig-iap-tunnel already exited');
      return;
    }
    throw err;
  }

  await waitForExit(pid);
  core.info('ig-iap-tunnel stopped');
}

run().catch(core.setFailed);
