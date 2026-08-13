import { access } from "node:fs/promises";
export async function dockerAvailable(){return access("/var/run/docker.sock").then(()=>true,()=>false)}
export function dockerCommand({repoPath,command,image="node:22-alpine",timeoutSeconds=120}) {
  return ["docker","run","--rm","--network=none","--read-only","--cap-drop=ALL",
    "--security-opt=no-new-privileges","--pids-limit=128","--memory=512m","--cpus=1",
    "--stop-timeout=3","--tmpfs","/tmp:rw,noexec,nosuid,size=128m","--mount",
    `type=bind,src=${repoPath},dst=/workspace,readonly`,"--workdir","/workspace",image,
    "timeout",String(timeoutSeconds),...command];
}
