import * as core from '@actions/core';
import * as fs from 'fs';
import { waitForExit } from './lib';

async function run(): Promise<void> {
  const pidStr = core.getState('pid');
  if (!pidStr) {
    core.info('No tunnel PID found — nothing to stop');
    return;
  }

  const pid = parseInt(pidStr, 10);

  try {
    process.kill(pid, 'SIGTERM');
    core.info(`Sent SIGTERM to ig-iap-tunnel (PID ${pid})`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
      core.info('ig-iap-tunnel already exited');
    } else {
      throw err;
    }
  }

  await waitForExit(pid);

  const logFile = core.getState('log_file');
  if (logFile) {
    core.startGroup('ig-iap-tunnel logs');
    try {
      core.info(fs.readFileSync(logFile, 'utf8'));
    } catch (err) {
      core.info(`(could not read log file ${logFile}: ${err})`);
    }
    core.endGroup();
  }

  core.info('ig-iap-tunnel stopped');
}

run().catch(core.setFailed);
