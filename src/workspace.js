import { mkdtemp, access, cp } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
export function validateRepo(repo){if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))throw new Error("Invalid GitHub repository name");return repo}
function exec(executable,args,{cwd,env=process.env}={}){return new Promise((resolve,reject)=>{const child=spawn(executable,args,{cwd,shell:false,env,stdio:["ignore","pipe","pipe"]});let out="",err="";child.stdout.on("data",c=>out+=c);child.stderr.on("data",c=>err+=c);child.on("error",reject);child.on("close",code=>code===0?resolve({out,err}):reject(new Error(`${executable} failed (${code}): ${err.slice(-2000)}`)))})}
export async function cloneRepository(repo,{root=process.env.WORKSPACE_ROOT||os.tmpdir()}={}){validateRepo(repo);const dir=await mkdtemp(path.join(root,"deploy-doctor-repo-"));await exec("git",["clone","--depth=1","--filter=blob:none","--no-tags",`https://github.com/${repo}.git`,dir],{env:{PATH:process.env.PATH,GIT_TERMINAL_PROMPT:"0"}});const{out}=await exec("git",["rev-parse","HEAD"],{cwd:dir});return{path:dir,sha:out.trim()}}
export async function applyPatchInCopy(sourcePath,patchFile,{root=os.tmpdir()}={}){await access(sourcePath);const dir=await mkdtemp(path.join(root,"deploy-doctor-fix-"));await cp(sourcePath,dir,{recursive:true});await exec("git",["apply","--check",patchFile],{cwd:dir});await exec("git",["apply",patchFile],{cwd:dir});return dir}
