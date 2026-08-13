import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { redact } from "./redact.js";

const exists = async (file) => access(file).then(() => true, () => false);

export async function detectFramework(repoPath) {
  const packageFile = path.join(repoPath, "package.json");
  if (await exists(packageFile)) {
    const pkg = JSON.parse(await readFile(packageFile, "utf8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.next) return { kind: "nextjs", commands: commandPlan(pkg, "npm") };
    return { kind: "node", commands: commandPlan(pkg, "npm") };
  }
  if (await exists(path.join(repoPath, "pyproject.toml")) || await exists(path.join(repoPath, "requirements.txt"))) {
    return { kind: "python", commands: [["python", "-m", "pytest"]] };
  }
  if (await exists(path.join(repoPath, "Dockerfile"))) return { kind: "docker", commands: [["docker", "build", "--network=none", "."]] };
  return { kind: "unknown", commands: [] };
}

function commandPlan(pkg) {
  const scripts = pkg.scripts ?? {};
  return ["test", "lint", "build"].filter((name) => scripts[name]).map((name) => ["npm", "run", name, "--"]);
}

export function diagnose(log, exitCode) {
  const lines = redact(log).split(/\r?\n/);
  const rules = [
    { re: /module not found|cannot find module/i, category: "dependency", summary: "A required module cannot be resolved." },
    { re: /type error|typescript error|ts\(\d+\)/i, category: "typecheck", summary: "Type checking failed." },
    { re: /test.*failed|assertionerror/i, category: "test", summary: "An automated test failed." },
    { re: /out of memory|heap limit/i, category: "resource", summary: "The build exceeded its memory budget." },
    { re: /timed? out|deadline exceeded/i, category: "timeout", summary: "The step exceeded its time budget." }
  ];
  for (let index = lines.length - 1; index >= 0; index--) {
    const rule = rules.find((item) => item.re.test(lines[index]));
    if (rule) return { ...rule, exitCode, evidence: { line: index + 1, text: lines[index] } };
  }
  return { category: "unknown", summary: "The process failed without a recognized signature.", exitCode, evidence: null };
}

export function runStep({ cwd, command, timeoutMs = 120000, signal, onLog = () => {} }) {
  const [executable, ...args] = command;
  const allowed = new Set(["npm", "node", "python", "python3", "docker"]);
  if (!allowed.has(executable)) throw new Error(`Command not allowed: ${executable}`);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      env: { PATH: process.env.PATH, CI: "true", NODE_ENV: "test", NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    const consume = (chunk) => { const text = redact(chunk); output += text; onLog(text); };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const cancel = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", cancel, { once: true });
    child.on("error", reject);
    child.on("close", (exitCode, killedBy) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      resolve({ exitCode: exitCode ?? 1, signal: killedBy, output, timedOut: killedBy === "SIGKILL" });
    });
  });
}
