import pg from "pg";
import { randomUUID } from "node:crypto";
import { redactValue } from "./redact.js";

const { Pool } = pg;
const schema = `
CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,email text UNIQUE NOT NULL,password_hash text NOT NULL,role text NOT NULL DEFAULT 'developer' CHECK(role IN ('developer','admin')),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions(id text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS jobs(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,repo text NOT NULL,repo_path text NOT NULL DEFAULT '',status text NOT NULL,framework text,result_json jsonb,worker_id text,lease_expires_at timestamptz,result_json_version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS worker_id text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS result_json_version integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS jobs_owner_created ON jobs(owner_id,created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_claimable ON jobs(status,created_at) WHERE status='queued';
CREATE TABLE IF NOT EXISTS events(seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,type text NOT NULL,payload_json jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS events_job_seq ON events(job_id,seq);
CREATE TABLE IF NOT EXISTS fixes(id uuid PRIMARY KEY,job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,base_branch text NOT NULL,branch text NOT NULL,patch text NOT NULL,status text NOT NULL,pr_url text,created_at timestamptz NOT NULL DEFAULT now());`;

export class PostgresStore {
  constructor(connectionString, pool = new Pool({connectionString,ssl:process.env.NODE_ENV==="production"?{rejectUnauthorized:false}:undefined,max:10})) { this.pool=pool; this.ready=this.pool.query(schema); }
  async query(sql,args=[]) { await this.ready; return this.pool.query(sql,args); }
  async createUser({email,passwordHash}) { const id=randomUUID(); const {rows}=await this.query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3) RETURNING id,email,created_at",[id,email.toLowerCase(),passwordHash]); return rows[0]; }
  async findUserByEmail(email) { const {rows}=await this.query("SELECT id,email,password_hash FROM users WHERE email=$1",[email.toLowerCase()]); return rows[0]??null; }
  async createSession({userId,id,expiresAt}) { await this.query("INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,$3)",[id,userId,expiresAt]); }
  async sessionUser(id) { const {rows}=await this.query("SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>now()",[id]); return rows[0]??null; }
  async deleteSession(id) { await this.query("DELETE FROM sessions WHERE id=$1",[id]); }
  mapJob(r){return{id:r.id,ownerId:r.owner_id,repo:r.repo,repoPath:r.repo_path,status:r.status,framework:r.framework,result:r.result_json,workerId:r.worker_id,leaseExpiresAt:r.lease_expires_at,createdAt:r.created_at,updatedAt:r.updated_at}}
  async createJob({ownerId,repo,repoPath=""}) { const id=randomUUID(); const {rows}=await this.query("INSERT INTO jobs(id,owner_id,repo,repo_path,status) VALUES($1,$2,$3,$4,'queued') RETURNING *",[id,ownerId,repo,repoPath]); await this.event(id,"job.created",{repo}); return this.mapJob(rows[0]); }
  async claimNext(workerId,leaseSeconds=300) { const {rows}=await this.query(`WITH candidate AS (SELECT id FROM jobs WHERE status='queued' OR (status='running' AND lease_expires_at<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE jobs j SET status='running',worker_id=$1,lease_expires_at=now()+make_interval(secs=>$2),updated_at=now() FROM candidate WHERE j.id=candidate.id RETURNING j.*`,[workerId,leaseSeconds]); if(!rows[0])return null; await this.event(rows[0].id,"job.claimed",{workerId,leaseSeconds}); return this.mapJob(rows[0]); }
  async heartbeat(id,workerId,leaseSeconds=300){const{rowCount}=await this.query("UPDATE jobs SET lease_expires_at=now()+make_interval(secs=>$1),updated_at=now() WHERE id=$2 AND worker_id=$3 AND status='running'",[leaseSeconds,id,workerId]);return rowCount===1}
  async setRepoPath(id,workerId,repoPath){const{rowCount}=await this.query("UPDATE jobs SET repo_path=$1,updated_at=now() WHERE id=$2 AND worker_id=$3 AND status='running'",[repoPath,id,workerId]);return rowCount===1}
  async requestCancel(id,ownerId){const{rows}=await this.query("UPDATE jobs SET status='cancelled',lease_expires_at=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2 AND status IN ('queued','running') RETURNING *",[id,ownerId]);if(rows[0])await this.event(id,"job.cancelled",{});return rows[0]?this.mapJob(rows[0]):this.getJob(id,ownerId)}
  async getJob(id,ownerId) { const {rows}=await this.query("SELECT * FROM jobs WHERE id=$1 AND owner_id=$2",[id,ownerId]); return rows[0]?this.mapJob(rows[0]):null; }
  async listJobs(ownerId) { const {rows}=await this.query("SELECT * FROM jobs WHERE owner_id=$1 ORDER BY created_at DESC",[ownerId]); return rows.map(r=>this.mapJob(r)); }
  async metrics() { const {rows}=await this.query(`SELECT
    count(*) FILTER (WHERE status='queued')::int AS queued,
    count(*) FILTER (WHERE status='running')::int AS running,
    count(*) FILTER (WHERE status='completed')::int AS completed,
    count(*) FILTER (WHERE status='failed')::int AS failed,
    count(*) FILTER (WHERE status='cancelled')::int AS cancelled,
    count(DISTINCT worker_id) FILTER (WHERE status='running' AND lease_expires_at>=now())::int AS active_workers,
    count(*) FILTER (WHERE status='running' AND lease_expires_at<now())::int AS expired_leases,
    (SELECT count(*)::int FROM events) AS events
    FROM jobs`); const r=rows[0]||{}; return {jobs:{queued:r.queued||0,running:r.running||0,completed:r.completed||0,failed:r.failed||0,cancelled:r.cancelled||0},activeWorkers:r.active_workers||0,expiredLeases:r.expired_leases||0,events:r.events||0}; }
  async update(id,status,patch={}) { await this.query("UPDATE jobs SET status=$1,framework=COALESCE($2,framework),result_json=COALESCE($3,result_json),updated_at=now() WHERE id=$4",[status,patch.framework??null,patch.result??null,id]); await this.event(id,`job.${status}`,patch); }
  async event(jobId,type,payload) { await this.query("INSERT INTO events(job_id,type,payload_json) VALUES($1,$2,$3)",[jobId,type,redactValue(payload)]); }
  async events(jobId,ownerId) { if(!await this.getJob(jobId,ownerId))return null; const {rows}=await this.query("SELECT seq,type,payload_json,created_at FROM events WHERE job_id=$1 ORDER BY seq",[jobId]); return rows.map(r=>({seq:Number(r.seq),type:r.type,payload:r.payload_json,createdAt:r.created_at})); }
  async createFix({jobId,ownerId,baseBranch="main",patch}) { if(!await this.getJob(jobId,ownerId))return null;if(baseBranch!=="main")throw new Error("Only main-based reviews are supported");const id=randomUUID(),branch=`deploy-doctor/${id.slice(0,8)}`;const{rows}=await this.query("INSERT INTO fixes(id,job_id,owner_id,base_branch,branch,patch,status) VALUES($1,$2,$3,$4,$5,$6,'proposed') RETURNING *",[id,jobId,ownerId,baseBranch,branch,patch]);await this.event(jobId,"fix.proposed",{fixId:id,branch});return this.mapFix(rows[0]); }
  mapFix(r){return{id:r.id,jobId:r.job_id,baseBranch:r.base_branch,branch:r.branch,patch:r.patch,status:r.status,prUrl:r.pr_url,createdAt:r.created_at}}
  async getFix(id,ownerId){const{rows}=await this.query("SELECT * FROM fixes WHERE id=$1 AND owner_id=$2",[id,ownerId]);return rows[0]?this.mapFix(rows[0]):null}
  async markFix(id,ownerId,status,prUrl=null){const{rows}=await this.query("UPDATE fixes SET status=$1,pr_url=$2 WHERE id=$3 AND owner_id=$4 RETURNING *",[status,prUrl,id,ownerId]);return rows[0]?this.mapFix(rows[0]):null}
}

export { schema as postgresSchema };
