import { detectFramework, diagnose, runStep } from "./engine.js";
import { cloneRepository } from "./workspace.js";
import { applyPatchInCopy } from "./workspace.js";
import { dockerAvailable,dockerCommand } from "./sandbox.js";
import { access,mkdtemp,writeFile } from "node:fs/promises";
import path from "node:path"; import os from "node:os";

export class JobService {
  constructor(store,{inline=process.env.RUN_JOBS_INLINE==="true"}={}) { this.store = store; this.running = new Map(); this.inline=inline; }
  async enqueue(input) { const job=await this.store.createJob({...input,repoPath:""}); if(this.inline)queueMicrotask(()=>this.runNext("inline-worker")); return job; }
  async runNext(workerId) { const job=await this.store.claimNext(workerId); if(!job)return null; await this.execute(job,workerId); return job.id; }
  async execute(job, workerId) {
    const {id,ownerId}=job; if (!job || job.status !== "running") return;
    const controller = new AbortController(); this.running.set(id, controller);
    try {
      const checkout=await cloneRepository(job.repo); if(!await this.store.setRepoPath(id,workerId,checkout.path))return; job.repoPath=checkout.path; await this.store.event(id,"repo.cloned",{sha:checkout.sha});
      const detected = await detectFramework(job.repoPath);
      await this.store.update(id, "running", { framework: detected.kind });
      if (!detected.commands.length) throw new Error("No safe diagnostic commands were detected");
      const isolated=await dockerAvailable(); if(process.env.NODE_ENV==="production"&&!isolated)throw new Error("Docker isolation is required in production");
      if(isolated&&["node","nextjs"].includes(detected.kind)&&await access(path.join(job.repoPath,"package-lock.json")).then(()=>true,()=>false)){
        const command=["npm","ci","--ignore-scripts","--no-audit","--no-fund"];await this.store.event(id,"dependencies.started",{command,network:"registry-only"});
        const result=await runStep({cwd:job.repoPath,command:dockerCommand({repoPath:job.repoPath,command,network:"bridge",timeoutSeconds:180}),signal:controller.signal,timeoutMs:180000});
        await this.store.event(id,"dependencies.finished",{exitCode:result.exitCode});if(result.exitCode!==0){await this.store.update(id,"failed",{result:diagnose(result.output,result.exitCode)});return}
      }
      for (const command of detected.commands) {
        if(!await this.store.heartbeat(id,workerId))return; const actual=isolated?dockerCommand({repoPath:job.repoPath,command}):command; await this.store.event(id, "step.started", { command,isolated });
        const pendingLogs=[]; const result = await runStep({ cwd: job.repoPath, command:actual, signal: controller.signal, onLog: (text) => pendingLogs.push(this.store.event(id, "step.log", { text })) }); await Promise.all(pendingLogs);
        await this.store.event(id, "step.finished", { command, exitCode: result.exitCode, timedOut: result.timedOut });
        const current=await this.store.getJob(id,ownerId); if (controller.signal.aborted||current?.status==="cancelled") return;
        if (result.exitCode !== 0) { await this.store.update(id, result.timedOut ? "timed_out" : "failed", { result: diagnose(result.output, result.exitCode) }); return; }
      }
      await this.store.update(id, "succeeded", { result: { summary: "All detected checks passed." } });
    } catch (error) { const current=await this.store.getJob(id,ownerId);if(current?.status!=="cancelled")await this.store.update(id, controller.signal.aborted ? "cancelled" : "failed", { result: { summary: String(error.message) } }); }
    finally { this.running.delete(id); }
  }
  async cancel(id, ownerId) { this.running.get(id)?.abort(); return this.store.requestCancel(id,ownerId); }
  async proposeFix({jobId,ownerId,patch}) {
    if(typeof patch!=="string"||!patch.startsWith("diff --git ")||Buffer.byteLength(patch)>1_000_000)throw new Error("A unified git diff under 1 MB is required");
    const job=await this.store.getJob(jobId,ownerId); if(!job)return null;
    const temp=await mkdtemp(path.join(os.tmpdir(),"deploy-doctor-patch-"));const patchFile=path.join(temp,"fix.diff");await writeFile(patchFile,patch,{mode:0o600});
    try { const candidate=await applyPatchInCopy(job.repoPath,patchFile);const detected=await detectFramework(candidate);if(!detected.commands.length)throw new Error("No verification commands detected after patch");const isolated=await dockerAvailable();if(process.env.NODE_ENV==="production"&&!isolated)throw new Error("Docker isolation is required in production");for(const command of detected.commands){const actual=isolated?dockerCommand({repoPath:candidate,command}):command;const result=await runStep({cwd:candidate,command:actual});if(result.exitCode!==0)throw new Error(`Patch verification failed: ${diagnose(result.output,result.exitCode).summary}`)}await this.store.event(jobId,"fix.verified",{framework:detected.kind,steps:detected.commands.length});return this.store.createFix({jobId,ownerId,patch}); }
    catch(error){await this.store.event(jobId,"fix.rejected",{reason:String(error.message)});throw error}
  }
}
