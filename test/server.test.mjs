import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleTriage } from "../server.mjs";

async function triage(rawBody) {
  const request = Readable.from([Buffer.from(rawBody)]);
  let statusCode;
  let responseBody;
  const response = {
    writeHead(status) { statusCode = status; },
    end(body) { responseBody = JSON.parse(body); },
  };
  await handleTriage(request, response);
  return { statusCode, body: responseBody };
}

test("returns manual review when the AI times out or returns malformed data", async (t) => {
  await t.test("timeout", async () => {
    const startedAt = Date.now();
    const result = await triage(JSON.stringify({ text: "Проверьте заявку [timeout]" }));
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.body, { status: "manual_review", topic: null, draft: null });
    assert.ok(Date.now() - startedAt < 900, "the request should finish close to the 300 ms limit");
  });

  await t.test("invalid JSON, topic, and empty draft", async () => {
    const malformed = await triage("{");
    assert.equal(malformed.statusCode, 400);
    assert.deepEqual(malformed.body, { status: "invalid_input" });

    for (const marker of ["[bad-json]", "[bad-topic]", "[empty-draft]"]) {
      const result = await triage(JSON.stringify({ text: `Проверьте заявку ${marker}` }));
      assert.equal(result.statusCode, 200);
      assert.deepEqual(result.body, { status: "manual_review", topic: null, draft: null });
    }
  });
});

test("rejects empty input and returns a valid successful result", async () => {
  const empty = await triage(JSON.stringify({ text: "   " }));
  assert.equal(empty.statusCode, 400);
  assert.deepEqual(empty.body, { status: "invalid_input" });

  const ready = await triage(JSON.stringify({ text: "Где моя доставка?" }));
  assert.equal(ready.statusCode, 200);
  assert.deepEqual(ready.body, {
    status: "ready",
    topic: "delivery",
    draft: "Спасибо за обращение. Уточним детали заявки.",
  });
});
