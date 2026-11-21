import { DesignJob, type IDesignJob } from '../models/DesignJob';
import { DesignError, runDesignJob } from './designPipeline';
import { closeRenderer } from '../design/renderer';

/**
 * Background worker for posters (runs inside the API process; MongoDB is the queue). One poster at
 * a time per server: rendering uses one Chromium. Jobs are claimed atomically, so several servers
 * can share the queue. DESIGN_WORKER=off turns it off on a server.
 */

const POLL_MS = 1500;
const CONCURRENCY = Number(process.env.DESIGN_WORKER_CONCURRENCY) || 1;
const MAX_ATTEMPTS = 2;
let active = 0;
let started = false;

async function claim(): Promise<IDesignJob | null> {
  return DesignJob.findOneAndUpdate(
    { status: 'queued' },
    { $set: { status: 'running', stage: 'reading', lockedAt: new Date() }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, new: true }
  );
}

async function work(job: IDesignJob): Promise<void> {
  try {
    await runDesignJob(job);
    await DesignJob.updateOne(
      { _id: job._id },
      { $set: { status: 'done', stage: 'done', progress: 1, draftIds: job.draftIds, message: job.message, cost: job.cost }, $unset: { lockedAt: 1, error: 1 } }
    );
  } catch (error: any) {
    const known = error instanceof DesignError;
    const retry = !known && job.attempts < MAX_ATTEMPTS;
    console.error('[design] Job failed:', error?.message || error);
    await DesignJob.updateOne(
      { _id: job._id },
      retry
        ? { $set: { status: 'queued', stage: 'queued', progress: 0 }, $unset: { lockedAt: 1 } }
        : { $set: { status: 'failed', error: known ? error.message : 'Something went wrong making the poster. Try again in a moment.' }, $unset: { lockedAt: 1 } }
    );
    // A renderer crash: start a fresh browser next time.
    if (!known) await closeRenderer().catch(() => undefined);
  }
}

async function tick(): Promise<void> {
  while (active < CONCURRENCY) {
    const job = await claim();
    if (!job) return;
    active++;
    void work(job).finally(() => {
      active--;
    });
  }
}

export function startDesignWorker(): void {
  if (started || process.env.DESIGN_WORKER === 'off') return;
  started = true;
  // Jobs left running by a restart go back in the queue.
  const recover = () =>
    DesignJob.updateMany({ status: 'running', lockedAt: { $lt: new Date(Date.now() - 10 * 60_000) } }, { $set: { status: 'queued', stage: 'queued' } }).catch(() => undefined);
  setTimeout(recover, 5000);
  // Design imports that were running when the server stopped are marked failed.
  setTimeout(() => import('./designImport').then((m) => m.markStaleImports()).catch(() => undefined), 5000);
  setInterval(() => {
    tick().catch((e) => console.error('[design] Worker error:', e));
  }, POLL_MS);
  setInterval(recover, 15 * 60_000);
  // Backgrounds, cut-outs and print files no poster uses any more: swept daily (DESIGN_SWEEP=off to skip).
  if (process.env.DESIGN_SWEEP !== 'off') {
    const sweep = () =>
      import('./designSweep')
        .then((m) => m.sweepDesignFiles())
        .then((r) => r.deleted && console.log(`[design] Swept ${r.deleted} unused poster file(s).`))
        .catch((e) => console.error('[design] Sweep failed:', e?.message || e));
    setTimeout(sweep, 10 * 60_000);
    setInterval(sweep, 24 * 3600_000);
  }
}
