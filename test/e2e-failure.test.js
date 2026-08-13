import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectFramework,runStep,diagnose } from "../src/engine.js";

test("reproduces a real repository failure and cites its emitted log",async()=>{
  const fixture=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../fixtures/failing-node");
  const detected=await detectFramework(fixture);
  assert.equal(detected.kind,"node");
  assert.deepEqual(detected.commands,[["npm","run","test","--"]]);
  const result=await runStep({cwd:fixture,command:detected.commands[0],timeoutMs:10000});
  assert.notEqual(result.exitCode,0);
  assert.match(result.output,/ERR_MODULE_NOT_FOUND|Cannot find module/);
  const diagnosis=diagnose(result.output,result.exitCode);
  assert.equal(diagnosis.category,"dependency");
  assert.ok(diagnosis.evidence.line>0);
  assert.equal(result.output.split(/\r?\n/)[diagnosis.evidence.line-1],diagnosis.evidence.text);
});
