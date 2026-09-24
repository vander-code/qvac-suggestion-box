// Suggestion Box - people submit suggestions, everyone can browse and upvote them.
// QVAC embeddings (on YOUR machine) spot DUPLICATES, sort each suggestion into a category,
// and let you search by meaning. Open http://localhost:3011 after starting.

import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadModel, embed, EMBEDDINGGEMMA_300M_Q4_0 } from "@qvac/sdk";

const PORT = 3011;
const SIMILAR_THRESHOLD = 0.62; // how alike two suggestions must be to be called "similar". Tune it: the server prints scores.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "data", "suggestions.json");

// The AI sorts a suggestion by finding which of these descriptions it is closest to in MEANING.
const CATEGORIES = {
  Idea: "I suggest adding a new feature or idea that would make things better.",
  Problem: "Something is broken, slow, annoying or not working and needs to be fixed.",
  Praise: "Thank you, I love this, great job, it works really well.",
  Question: "I have a question and would like to know how something works.",
};

// ---- Storage: a plain JSON file on your computer ----
let items = []; // { id, text, name, category, votes, done, created, embedding }
async function loadData() { try { items = JSON.parse(await readFile(DATA_FILE, "utf8")); } catch { items = []; } }
async function saveData() { await mkdir(path.dirname(DATA_FILE), { recursive: true }); await writeFile(DATA_FILE, JSON.stringify(items)); }
const view = (s) => ({ id: s.id, text: s.text, name: s.name, category: s.category, votes: s.votes, done: s.done, created: s.created });

// ---- Step 1: load the embedding model (downloads the first time) ----
let modelId = null;
const status = { ready: false, message: "Starting...", percent: null, error: null };

async function startModel() {
  try {
    status.message = "Loading the smart-sorting model (first run downloads it)...";
    modelId = await loadModel({
      modelSrc: EMBEDDINGGEMMA_300M_Q4_0,
      modelType: "embeddings",
      onProgress: (p) => {
        const value = typeof p === "number" ? p : p?.percentage;
        if (typeof value === "number") status.percent = Math.round(value);
      },
    });
    status.ready = true;
    status.message = "Smart sorting ready";
    console.log("Model loaded. Open http://localhost:" + PORT);
  } catch (err) {
    status.error = String(err?.message || err);
    console.error("Could not load model:", err);
  }
}

// ---- Step 2: turn text into numbers (an "embedding") with QVAC. Similar meanings get similar numbers. ----
const cache = new Map();
async function vectors(texts) {
  if (cache.size > 1000) cache.clear();
  const missing = [...new Set(texts.filter((t) => !cache.has(t)))];
  for (let i = 0; i < missing.length; i += 16) {
    const batch = missing.slice(i, i + 16);
    const out = await embed({ modelId, text: batch });
    const emb = out.embedding ?? out.embeddings ?? out;
    const rows = Array.isArray(emb[0]) ? emb : [emb];
    batch.forEach((t, k) => cache.set(t, rows[k]));
  }
  return texts.map((t) => cache.get(t));
}
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// Suggestions saved while the model was still loading get their numbers later
async function fillMissing() {
  const todo = items.filter((s) => !s.embedding);
  if (!todo.length) return;
  const vs = await vectors(todo.map((s) => s.text));
  todo.forEach((s, i) => (s.embedding = vs[i]));
  await saveData();
}

// ---- Step 3: the smart features ----
async function categoryOf(vec) {
  const names = Object.keys(CATEGORIES);
  const cats = await vectors(names.map((n) => CATEGORIES[n]));
  return names.map((n, i) => [n, cosine(vec, cats[i])]).sort((a, b) => b[1] - a[1])[0][0];
}

async function check(text) {
  if (!status.ready) return { category: null, similar: [] };
  await fillMissing();
  const [vec] = await vectors([text]);
  const ranked = items.filter((s) => s.embedding && !s.done)
    .map((s) => ({ s, score: cosine(vec, s.embedding) })).sort((a, b) => b.score - a.score);
  if (ranked[0]) console.log("Most similar existing suggestion scored", ranked[0].score.toFixed(2), "(threshold " + SIMILAR_THRESHOLD + ")");
  return { category: await categoryOf(vec), similar: ranked.filter((r) => r.score >= SIMILAR_THRESHOLD).slice(0, 2).map((r) => view(r.s)) };
}

async function search(query) {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const keyword = (s) => (words.length ? words.filter((w) => s.text.toLowerCase().includes(w)).length / words.length : 0);
  if (!status.ready) return items.filter((s) => keyword(s) > 0).map((s) => s.id);
  await fillMissing();
  const [vec] = await vectors([query]);
  const ranked = items.filter((s) => s.embedding).map((s) => ({ id: s.id, score: cosine(vec, s.embedding) + keyword(s) * 0.15 })).sort((a, b) => b.score - a.score);
  if (!ranked.length) return [];
  return ranked.filter((r) => r.score >= ranked[0].score - 0.15).slice(0, 10).map((r) => r.id); // drop results far worse than the best
}

// ---- Step 4: a small web server ----
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > 20000) { reject(new Error("Too big")); req.destroy(); } });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(await readFile(path.join(__dirname, "public", "index.html")));
    }
    if (req.method === "GET" && req.url === "/api/status") return json(res, 200, status);
    if (req.method === "GET" && req.url === "/api/suggestions") return json(res, 200, items.map(view));

    const body = req.method === "POST" ? JSON.parse((await readBody(req)) || "{}") : {};

    if (req.method === "POST" && req.url === "/api/check") return json(res, 200, await check(String(body.text || "").slice(0, 500)));
    if (req.method === "POST" && req.url === "/api/search") return json(res, 200, await search(String(body.q || "").slice(0, 200)));

    if (req.method === "POST" && req.url === "/api/suggestions") {
      const text = String(body.text || "").trim().slice(0, 500);
      if (text.length < 3) return json(res, 400, { error: "Please write a little more." });
      const s = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text,
        name: String(body.name || "").trim().slice(0, 30) || "Anonymous",
        category: Object.keys(CATEGORIES).includes(body.category) ? body.category : "Idea",
        votes: 0, done: false, created: Date.now(), embedding: null,
      };
      if (status.ready) { try { s.embedding = (await vectors([s.text]))[0]; } catch (e) { console.error(e); } }
      items.push(s); await saveData();
      return json(res, 201, view(s));
    }

    if (req.method === "POST" && req.url === "/api/action") {
      const s = items.find((x) => x.id === body.id);
      if (!s) return json(res, 404, { error: "Not found" });
      if (body.action === "vote") s.votes++;
      else if (body.action === "unvote") s.votes = Math.max(0, s.votes - 1);
      else if (body.action === "done") s.done = true;
      else if (body.action === "reopen") s.done = false;
      else if (body.action === "delete") items = items.filter((x) => x !== s);
      await saveData();
      return json(res, 200, { ok: true });
    }

    res.writeHead(404); res.end("Not found");
  } catch (err) {
    console.error(err);
    json(res, 500, { error: String(err?.message || err) });
  }
});

await loadData();
// "127.0.0.1" means only YOUR computer can reach this app
server.listen(PORT, "127.0.0.1", () => console.log("Server running at http://localhost:" + PORT));
startModel();
