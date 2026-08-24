import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { redactValue } from "./redact.js";

export class Store {
  constructor(filename = ".data/deploy-doctor.db") {
    if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, repo TEXT NOT NULL, repo_path TEXT NOT NULL,
        status TEXT NOT NULL, framework TEXT, result_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, type TEXT NOT NULL,
        payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
        FOREIGN KEY(job_id) REFERENCES jobs(id)
      );
      CREATE TABLE IF NOT EXISTS fixes (
        id TEXT PRIMARY KEY, job_id TEXT NOT NULL, owner_id TEXT NOT NULL, base_branch TEXT NOT NULL,
        branch TEXT NOT NULL, patch TEXT NOT NULL, status TEXT NOT NULL, pr_url TEXT, created_at TEXT NOT NULL,
        FOREIGN KEY(job_id) REFERENCES jobs(id)
      );
    `);
  }
  claimNext(workerId, leaseSeconds = 120) {
    const row=this.db.prepare("SELECT id FROM jobs WHERE status='queued' ORDER BY created_at LIMIT 1").get(); if(!row)return null;
    this.db.prepare("UPDATE jobs SET status='running',updated_at=? WHERE id=? AND status='queued'").run(new Date().toISOString(),row.id);
    const claimed=this.db.prepare("SELECT * FROM jobs WHERE id=?").get(row.id); this.event(row.id,"job.claimed",{workerId,leaseSeconds});
    return { ...this.getJob(claimed.id,claimed.owner_id), ownerId:claimed.owner_id, workerId };
  }
  heartbeat(){return true}
  setRepoPath(id,_workerId,repoPath){this.db.prepare("UPDATE jobs SET repo_path=?,updated_at=? WHERE id=?").run(repoPath,new Date().toISOString(),id);return true}
  requestCancel(id,ownerId){const job=this.getJob(id,ownerId);if(!job)return null;if(["queued","running"].includes(job.status)){this.update(id,"cancelled");return this.getJob(id,ownerId)}return job}
  createJob({ ownerId, repo, repoPath }) {
    const id = randomUUID(); const now = new Date().toISOString();
    this.db.prepare("INSERT INTO jobs VALUES (?, ?, ?, ?, 'queued', NULL, NULL, ?, ?)").run(id, ownerId, repo, repoPath, now, now);
    this.event(id, "job.created", { repo });
    return this.getJob(id, ownerId);
  }
  getJob(id, ownerId) {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id=? AND owner_id=?").get(id, ownerId);
    if (!row) return null;
    return { id: row.id, ownerId:row.owner_id, repo: row.repo, repoPath: row.repo_path, status: row.status, framework: row.framework, result: row.result_json ? JSON.parse(row.result_json) : null, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  listJobs(ownerId) { return this.db.prepare("SELECT id FROM jobs WHERE owner_id=? ORDER BY created_at DESC").all(ownerId).map(({ id }) => this.getJob(id, ownerId)); }
  update(id, status, patch = {}) {
    this.db.prepare("UPDATE jobs SET status=?, framework=COALESCE(?,framework), result_json=COALESCE(?,result_json), updated_at=? WHERE id=?")
      .run(status, patch.framework ?? null, patch.result ? JSON.stringify(patch.result) : null, new Date().toISOString(), id);
    this.event(id, `job.${status}`, patch);
  }
  event(jobId, type, payload) { this.db.prepare("INSERT INTO events(job_id,type,payload_json,created_at) VALUES (?,?,?,?)").run(jobId, type, JSON.stringify(redactValue(payload)), new Date().toISOString()); }
  events(jobId, ownerId) {
    if (!this.getJob(jobId, ownerId)) return null;
    return this.db.prepare("SELECT seq,type,payload_json,created_at FROM events WHERE job_id=? ORDER BY seq").all(jobId).map((r) => ({ seq: r.seq, type: r.type, payload: JSON.parse(r.payload_json), createdAt: r.created_at }));
  }
  createFix({ jobId, ownerId, baseBranch = "main", patch }) {
    if (!this.getJob(jobId, ownerId)) return null;
    if (baseBranch !== "main") throw new Error("Only main-based reviews are supported");
    const id = randomUUID(); const branch = `deploy-doctor/${id.slice(0, 8)}`;
    this.db.prepare("INSERT INTO fixes VALUES (?,?,?,?,?,?,'proposed',NULL,?)").run(id, jobId, ownerId, baseBranch, branch, patch, new Date().toISOString());
    this.event(jobId, "fix.proposed", { fixId: id, branch }); return this.getFix(id, ownerId);
  }
  getFix(id, ownerId) { const r=this.db.prepare("SELECT * FROM fixes WHERE id=? AND owner_id=?").get(id,ownerId); return r ? { id:r.id,jobId:r.job_id,baseBranch:r.base_branch,branch:r.branch,patch:r.patch,status:r.status,prUrl:r.pr_url,createdAt:r.created_at } : null; }
  markFix(id, ownerId, status, prUrl = null) { this.db.prepare("UPDATE fixes SET status=?,pr_url=? WHERE id=? AND owner_id=?").run(status,prUrl,id,ownerId); return this.getFix(id,ownerId); }
}
