import test from "node:test";
import assert from "node:assert/strict";
import { PostgresStore } from "../src/postgres-store.js";

const connectionString=process.env.TEST_DATABASE_URL;
test("PostgreSQL queue atomically claims once and persists cancellation",{skip:!connectionString},async()=>{
  const store=new PostgresStore(connectionString); await store.ready;
  const suffix=`${Date.now()}-${Math.random()}`;const user=await store.createUser({email:`queue-${suffix}@example.test`,passwordHash:"test-only"});
  const job=await store.createJob({ownerId:user.id,repo:"openai/example"});
  const [first,second]=await Promise.all([store.claimNext("worker-a"),store.claimNext("worker-b")]);
  assert.equal([first,second].filter(Boolean).length,1);assert.equal((first||second).id,job.id);
  const cancelled=await store.requestCancel(job.id,user.id);assert.equal(cancelled.status,"cancelled");
  assert.equal(await store.heartbeat(job.id,(first||second).workerId),false);
  await store.pool.end();
});
