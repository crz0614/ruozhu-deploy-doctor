import { randomUUID } from "node:crypto";
import { PostgresStore } from "./postgres-store.js";
import { JobService } from "./service.js";

if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is required by the worker");
const store=new PostgresStore(process.env.DATABASE_URL);
const service=new JobService(store);
const workerId=process.env.WORKER_ID||`worker-${randomUUID().slice(0,8)}`;
const interval=Math.max(250,Number(process.env.POLL_INTERVAL_MS||1000));
let stopping=false;
process.on("SIGTERM",()=>{stopping=true}); process.on("SIGINT",()=>{stopping=true});
while(!stopping){
  try { const claimed=await service.runNext(workerId); if(!claimed)await new Promise(resolve=>setTimeout(resolve,interval)); }
  catch(error){console.error(JSON.stringify({level:"error",workerId,error:String(error.message)}));await new Promise(resolve=>setTimeout(resolve,interval));}
}
await store.pool.end();
