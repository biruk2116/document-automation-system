/**
 * MVP in-memory background job tracker for bulk PDF generation.
 *
 * NOTE: FR-019 specifies Node.js Queue/Bull (Redis-backed) for production, which
 * also satisfies NFR-004 (offline queueing / job retry if DB is down across restarts).
 * This in-memory version covers the same UX (progress polling, "45/100 completed")
 * for a single-process deployment, but jobs are lost on server restart and this
 * does not scale across multiple server instances. Swap this module for a real
 * Bull + Redis queue before production/scale deployment.
 */

const jobs = new Map(); // jobId -> { total, completed, failed, status, results[] }

function createJob(total) {
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  jobs.set(jobId, {
    jobId,
    total,
    completed: 0,
    failed: 0,
    status: 'running', // running | completed | failed
    results: [], // { recordId, success, docId?, error? }
    startedAt: new Date().toISOString(),
    finishedAt: null,
  });
  return jobId;
}

function updateJobProgress(jobId, resultEntry) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.results.push(resultEntry);
  if (resultEntry.success) job.completed += 1;
  else job.failed += 1;

  if (job.completed + job.failed >= job.total) {
    job.status = job.failed > 0 && job.completed === 0 ? 'failed' : 'completed';
    job.finishedAt = new Date().toISOString();
  }
}

function getJob(jobId) {
  return jobs.get(jobId) || null;
}

module.exports = { createJob, updateJobProgress, getJob };
