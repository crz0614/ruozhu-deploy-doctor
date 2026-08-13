import { detectFramework, diagnose, runStep } from "./engine.js";
import { cloneRepository } from "./workspace.js";
import { applyPatchInCopy } from "./workspace.js";
import { dockerAvailable,dockerCommand } from "./sandbox.js";
import { mkdtemp,writeFile } from "node:fs/promises";
import path from "node:path"; import os from "node:os";

export class JobService {
  constructor(store) { this.store = store; this.running = new Map(); }
  async enqueue(input) { const checkout=await cloneRepository(input.repo); const job = await this.store.createJob({...input,repoPath:checkout.path}); await this.store.event(job.id,"repo.cloned",{sha:checkout.sha}); queueMicrotask(() => this.execute(job.id, input.ownerId)); return job; }
  async execute(id, ownerId) {
    const job = await this.store.getJob(id, ownerId); if (!job || job.status !== "queued") return;
    const controller = new AbortController(); this.running.set(id, controller);
    try {
      await this.store.update(id, "running");
      const detected = await detectFramework(job.repoPath);
      await this.store.update(id, "running", { framework: detected.kind });
      if (!detected.commands.length) throw new Error("No safe diagnostic commands were detected");
      const isolated=await dockerAvailable(); if(process.env.NODE_ENV==="production"&&!isolated)throw new Error("Docker isolation is required in production");
      for (const command of detected.commands) {
        const actual=isolated?dockerCommand({repoPath:job.repoPath,command}):command; await this.store.event(id, "step.started", { command,isolated });
        const pendingLogs=[]; const result = await runStep({ cwd: job.repoPath, command:actual, signal: controller.signal, onLog: (text) => pendingLogs.push(this.store.event(id, "step.log", { text })) }); await Promise.all(pendingLogs);
        await this.store.event(id, "step.finished", { command, exitCode: result.exitCode, timedOut: result.timedOut });
        if (controller.signal.aborted) { await this.store.update(id, "cancelled"); return; }
        if (result.exitCode !== 0) { await this.store.update(id, result.timedOut ? "timed_out" : "failed", { result: diagnose(result.output, result.exitCode) }); return; }
      }
      await this.store.update(id, "succeeded", { result: { summary: "All detected checks passed." } });
    } catch (error) { await this.store.update(id, controller.signal.aborted ? "cancelled" : "failed", { result: { summary: String(error.message) } }); }
    finally { this.running.delete(id); }
  }
  async cancel(id, ownerId) { const job = await this.store.getJob(id, ownerId); if (!job) return null; this.running.get(id)?.abort(); if (job.status === "queued") await this.store.update(id, "cancelled"); return this.store.getJob(id, ownerId); }
  async proposeFix({jobId,ownerId,patch}) {
    if(typeof patch!=="string"||!patch.startsWith("diff --git ")||Buffer.byteLength(patch)>1_000_000)throw new Error("A unified git diff under 1 MB is required");
    const job=await this.store.getJob(jobId,ownerId); if(!job)return null;
    const temp=await mkdtemp(path.join(os.tmpdir(),"deploy-doctor-patch-"));const patchFile=path.join(temp,"fix.diff");await writeFile(patchFile,patch,{mode:0o600});
    try { const candidate=await applyPatchInCopy(job.repoPath,patchFile);const detected=await detectFramework(candidate);if(!detected.commands.length)throw new Error("No verification commands detected after patch");const isolated=await dockerAvailable();if(process.env.NODE_ENV==="production"&&!isolated)throw new Error("Docker isolation is required in production");for(const command of detected.commands){const actual=isolated?dockerCommand({repoPath:candidate,command}):command;const result=await runStep({cwd:candidate,command:actual});if(result.exitCode!==0)throw new Error(`Patch verification failed: ${diagnose(result.output,result.exitCode).summary}`)}await this.store.event(jobId,"fix.verified",{framework:detected.kind,steps:detected.commands.length});return this.store.createFix({jobId,ownerId,patch}); }
    catch(error){await this.store.event(jobId,"fix.rejected",{reason:String(error.message)});throw error}
  }
}
