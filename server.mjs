import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));
const MODEL_TIMEOUT_MS = 300;
const ALLOWED_TOPICS = new Set(["delivery", "pricing", "other"]);

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function isValidModelResult(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && ALLOWED_TOPICS.has(value.topic)
    && typeof value.draft === "string"
    && value.draft.trim().length > 0;
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function handleTriage(request, response) {
  let body;
  try {
    body = await readRequestBody(request);
  } catch {
    json(response, 400, { status: "invalid_input" });
    return;
  }

  if (!body || typeof body.text !== "string" || body.text.trim().length === 0) {
    json(response, 400, { status: "invalid_input" });
    return;
  }

  const controller = new AbortController();
  let timeoutId;
  try {
    const modelOutput = await Promise.race([
      classify(body.text, { signal: controller.signal }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new Error("AI request timed out"));
        }, MODEL_TIMEOUT_MS);
      }),
    ]);
    const result = JSON.parse(modelOutput);
    if (!isValidModelResult(result)) throw new Error("Invalid AI response");
    json(response, 200, { status: "ready", topic: result.topic, draft: result.draft.trim() });
  } catch {
    json(response, 200, { status: "manual_review", topic: null, draft: null });
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createApp() {
  return createHttpServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method === "POST" && request.url === "/api/triage") {
      await handleTriage(request, response);
      return;
    }
    json(response, 404, { status: "not_found" });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp().listen(Number(process.env.PORT || 3000), "127.0.0.1");
}
