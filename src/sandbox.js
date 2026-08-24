import { access } from "node:fs/promises";
export async function dockerAvailable(){return access("/var/run/docker.sock").then(()=>true,()=>false)}
export function dockerCommand({repoPath,command,image="node:22-alpine",timeoutSeconds=120,network="none"}) {
  const workspaceRoot=process.env.WORKSPACE_ROOT; const volume=process.env.WORKSPACE_VOLUME;
  const shared=workspaceRoot&&volume&&repoPath.startsWith(`${workspaceRoot}/`);
  const mount=shared?`type=volume,src=${volume},dst=${workspaceRoot}`:`type=bind,src=${repoPath},dst=/workspace`;
  const workdir=shared?repoPath:"/workspace";
  return ["docker","run","--rm",`--network=${network}`,"--read-only","--cap-drop=ALL",
    "--security-opt=no-new-privileges","--pids-limit=128","--memory=512m","--cpus=1",
    "--stop-timeout=3","--tmpfs","/tmp:rw,noexec,nosuid,size=128m","--mount",
    mount,"--workdir",workdir,image,
    "timeout",String(timeoutSeconds),...command];
}
