import http from "node:http";
import { readFile } from "node:fs/promises";
import { Store } from "./store.js";
import { PostgresStore } from "./postgres-store.js";
import { JobService } from "./service.js";
import { publicEnv } from "./redact.js";
import { hashPassword,verifyPassword,newSession,parseCookies,sessionCookie } from "./auth.js";
import { GitHubClient } from "./github.js";
import { renderMetrics } from "./metrics.js";

const store = process.env.DATABASE_URL ? new PostgresStore(process.env.DATABASE_URL) : new Store(process.env.DATABASE_FILE);
const service = new JobService(store);
const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
const text = (res, status, value) => { res.writeHead(status, { "content-type": "text/plain; version=0.0.4; charset=utf-8" }); res.end(value); };
const body = async (req) => { let raw = ""; for await (const chunk of req) { raw += chunk; if (raw.length > 100_000) throw new Error("Body too large"); } return JSON.parse(raw || "{}"); };

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const sessionId=parseCookies(req.headers.cookie).dd_session; const user=sessionId&&store.sessionUser?await store.sessionUser(sessionId):(!process.env.DATABASE_URL?{id:"local-user",email:"local@deploy.doctor"}:null); const ownerId=user?.id;
    if (req.method === "GET" && url.pathname === "/") { const page = await readFile(new URL("../public/index.html", import.meta.url)); res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(page); }
    if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true, database: process.env.DATABASE_URL?"postgresql":"sqlite", github: publicEnv(["GITHUB_TOKEN"])[0],isolation:process.env.NODE_ENV==="production"?"required":"development-fallback" });
    if (req.method === "GET" && url.pathname === "/metrics") return text(res, 200, renderMetrics(await store.metrics()));
    if (req.method === "GET" && url.pathname === "/api/repositories") { const client=new GitHubClient({token:process.env.GITHUB_TOKEN}); return json(res,200,await client.listRepositories()); }
    if(req.method==="POST"&&url.pathname==="/api/auth/register"){if(!store.createUser)return json(res,501,{error:"Accounts require PostgreSQL"});const input=await body(req);const created=await store.createUser({email:input.email,passwordHash:await hashPassword(input.password)});const id=newSession();await store.createSession({userId:created.id,id,expiresAt:new Date(Date.now()+604800000)});res.setHeader("set-cookie",sessionCookie(id));return json(res,201,{id:created.id,email:created.email})}
    if(req.method==="POST"&&url.pathname==="/api/auth/login"){const input=await body(req);const found=await store.findUserByEmail?.(input.email);if(!found||!await verifyPassword(input.password,found.password_hash))return json(res,401,{error:"Invalid credentials"});const id=newSession();await store.createSession({userId:found.id,id,expiresAt:new Date(Date.now()+604800000)});res.setHeader("set-cookie",sessionCookie(id));return json(res,200,{id:found.id,email:found.email})}
    if(req.method==="POST"&&url.pathname==="/api/auth/logout"){if(sessionId&&store.deleteSession)await store.deleteSession(sessionId);res.setHeader("set-cookie",sessionCookie("",0));return json(res,200,{ok:true})}
    if(req.method==="GET"&&url.pathname==="/api/auth/me")return json(res,user?200:401,user??{error:"Authentication required"});
    if(url.pathname.startsWith("/api/")&&!['/api/health','/api/auth/register','/api/auth/login'].includes(url.pathname)&&!ownerId)return json(res,401,{error:"Authentication required"});
    if (req.method === "GET" && url.pathname === "/api/jobs") return json(res, 200, await store.listJobs(ownerId));
    if (req.method === "POST" && url.pathname === "/api/jobs") {
      const input = await body(req); if (!input.repo) return json(res, 400, { error: "repo is required" });
      return json(res, 202, await service.enqueue({ ownerId, repo: input.repo }));
    }
    const match = url.pathname.match(/^\/api\/jobs\/([^/]+)(?:\/(events|cancel))?$/);
    if (match && req.method === "GET" && !match[2]) { const job = await store.getJob(match[1], ownerId); return json(res, job ? 200 : 404, job ?? { error: "Not found" }); }
    if (match && req.method === "GET" && match[2] === "events") { const events = await store.events(match[1], ownerId); return json(res, events ? 200 : 404, events ?? { error: "Not found" }); }
    if (match && req.method === "POST" && match[2] === "cancel") { const job = await service.cancel(match[1], ownerId); return json(res, job ? 200 : 404, job ?? { error: "Not found" }); }
    if (match && req.method === "POST" && !match[2]) { const input=await body(req); if(input.action!=="propose-fix"||!input.patch) return json(res,400,{error:"action=propose-fix and patch are required"}); const fix=await service.proposeFix({jobId:match[1],ownerId,patch:input.patch}); return json(res,fix?201:404,fix??{error:"Not found"}); }
    const fixMatch=url.pathname.match(/^\/api\/fixes\/([^/]+)\/approve$/);
    if(fixMatch&&req.method==="POST") { const fix=await store.getFix(fixMatch[1],ownerId); if(!fix)return json(res,404,{error:"Not found"}); if(fix.status!=="proposed")return json(res,409,{error:"Fix is not awaiting approval"}); const input=await body(req); const job=await store.getJob(fix.jobId,ownerId); const client=new GitHubClient({token:process.env.GITHUB_TOKEN}); const published=await client.createReviewPullRequest({repo:job.repo,baseSha:input.baseSha,branch:fix.branch,baseBranch:fix.baseBranch,patch:fix.patch}); return json(res,201,await store.markFix(fix.id,ownerId,"published",published.prUrl)); }
    return json(res, 404, { error: "Not found" });
  } catch (error) { return json(res, 500, { error: String(error.message) }); }
});

if (process.env.NODE_ENV !== "test") server.listen(Number(process.env.PORT || 3000), () => console.log("Deploy Doctor listening"));
