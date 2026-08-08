import assert from "node:assert/strict";
import test from "node:test";
import {
  checkSignInThrottle,
  clearSignInFailures,
  recordSignInFailure,
} from "../lib/runtime-storage.ts";

test("eight repeated sign-in failures trigger a fifteen-minute block", async () => {
  const keys = [`test-${crypto.randomUUID()}`];
  await clearSignInFailures(keys);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    assert.equal((await checkSignInThrottle(keys)).allowed, true);
    await recordSignInFailure(keys);
  }

  const blocked = await checkSignInThrottle(keys);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);

  await clearSignInFailures(keys);
  assert.equal((await checkSignInThrottle(keys)).allowed, true);
});
