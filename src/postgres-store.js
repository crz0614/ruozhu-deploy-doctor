import pg from "pg";
import { randomUUID } from "node:crypto";
import { redactValue } from "./redact.js";

const { Pool } = pg;
const schema = `
CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,email text UNIQUE NOT NULL,password_hash text NOT NULL,role text NOT NULL DEFAULT 'developer' CHECK(role IN ('developer','admin')),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions(id text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS jobs(id uuid PRIMARY KEY,owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,repo text NOT NULL,repo_path text NOT NULL,status text NOT NULL,framework text,result_json jsonb,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS jobs_owner_created ON jobs(owner_id,created_at DESC);
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
  mapJob(r){return{id:r.id,repo:r.repo,repoPath:r.repo_path,status:r.status,framework:r.framework,result:r.result_json,createdAt:r.created_at,updatedAt:r.updated_at}}
  async createJob({ownerId,repo,repoPath}) { const id=randomUUID(); const {rows}=await this.query("INSERT INTO jobs(id,owner_id,repo,repo_path,status) VALUES($1,$2,$3,$4,'queued') RETURNING *",[id,ownerId,repo,repoPath]); await this.event(id,"job.created",{repo}); return this.mapJob(rows[0]); }
  async getJob(id,ownerId) { const {rows}=await this.query("SELECT * FROM jobs WHERE id=$1 AND owner_id=$2",[id,ownerId]); return rows[0]?this.mapJob(rows[0]):null; }
  async listJobs(ownerId) { const {rows}=await this.query("SELECT * FROM jobs WHERE owner_id=$1 ORDER BY created_at DESC",[ownerId]); return rows.map(r=>this.mapJob(r)); }
  async update(id,status,patch={}) { await this.query("UPDATE jobs SET status=$1,framework=COALESCE($2,framework),result_json=COALESCE($3,result_json),updated_at=now() WHERE id=$4",[status,patch.framework??null,patch.result??null,id]); await this.event(id,`job.${status}`,patch); }
  async event(jobId,type,payload) { await this.query("INSERT INTO events(job_id,type,payload_json) VALUES($1,$2,$3)",[jobId,type,redactValue(payload)]); }
  async events(jobId,ownerId) { if(!await this.getJob(jobId,ownerId))return null; const {rows}=await this.query("SELECT seq,type,payload_json,created_at FROM events WHERE job_id=$1 ORDER BY seq",[jobId]); return rows.map(r=>({seq:Number(r.seq),type:r.type,payload:r.payload_json,createdAt:r.created_at})); }
  async createFix({jobId,ownerId,baseBranch="main",patch}) { if(!await this.getJob(jobId,ownerId))return null;if(baseBranch!=="main")throw new Error("Only main-based reviews are supported");const id=randomUUID(),branch=`deploy-doctor/${id.slice(0,8)}`;const{rows}=await this.query("INSERT INTO fixes(id,job_id,owner_id,base_branch,branch,patch,status) VALUES($1,$2,$3,$4,$5,$6,'proposed') RETURNING *",[id,jobId,ownerId,baseBranch,branch,patch]);await this.event(jobId,"fix.proposed",{fixId:id,branch});return this.mapFix(rows[0]); }
  mapFix(r){return{id:r.id,jobId:r.job_id,baseBranch:r.base_branch,branch:r.branch,patch:r.patch,status:r.status,prUrl:r.pr_url,createdAt:r.created_at}}
  async getFix(id,ownerId){const{rows}=await this.query("SELECT * FROM fixes WHERE id=$1 AND owner_id=$2",[id,ownerId]);return rows[0]?this.mapFix(rows[0]):null}
  async markFix(id,ownerId,status,prUrl=null){const{rows}=await this.query("UPDATE fixes SET status=$1,pr_url=$2 WHERE id=$3 AND owner_id=$4 RETURNING *",[status,prUrl,id,ownerId]);return rows[0]?this.mapFix(rows[0]):null}
}

export { schema as postgresSchema };
