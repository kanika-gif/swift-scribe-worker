export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ---------- Root: simple UI (shows full JSON) ----------
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(`<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Swift-Scribe</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:16px;max-width:760px;margin:auto}
textarea,input,button,pre{width:100%} textarea{min-height:140px}
button{padding:10px;font-weight:600}
pre{white-space:pre-wrap;background:#f6f7f9;padding:12px;border-radius:8px}
a{color:#0b5fff;text-decoration:none}
</style>
</head>
<body>
<h2>Swift-Scribe</h2>
<p><a href="/how">How to POST audio from iPhone</a></p>
<textarea id="t" placeholder="Paste or type text to summarize…"></textarea><br>
<input id="title" placeholder="Title (optional)" style="margin:6px 0;"><br>
<button id="b">Summarize</button>
<pre id="o">No output</pre>
<script>
const b=document.getElementById("b"), o=document.getElementById("o");
b.onclick = async () => {
  const text = document.getElementById("t").value;
  const title = document.getElementById("title").value;
  o.textContent = "…";
  try{
    const r = await fetch('/summarize', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ text, title })
    });
    const j = await r.json();
    o.textContent = JSON.stringify(j, null, 2);
  }catch(e){
    o.textContent = "Request failed: " + (e.message||e);
  }
};
</script>
</body>
</html>`, { headers: { "content-type": "text/html; charset=utf-8" }});
    }

    // ---------- How-to page ----------
    if (request.method === "GET" && url.pathname === "/how") {
      return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<h3>Upload audio via iPhone Shortcuts</h3>
<ol>
<li>Create a Shortcut:
  <ul>
    <li><b>Select File</b> (pick a Voice Memo or audio file)</li>
    <li><b>Get Contents of URL</b> → Method: <b>POST</b> → URL: <code>/transcribe-summarize</code></li>
    <li><b>Request Body</b>: <b>Form</b> → field name <code>file</code> = (Selected File)</li>
    <li><b>Get Dictionary from Input</b> → <b>Show Result</b> of key <code>note</code> (or display full JSON)</li>
  </ul>
</li>
</ol>`, { headers: { "content-type": "text/html; charset=utf-8" }});
    }

    // ---------- Text summarize ----------
    if (request.method === "POST" && url.pathname === "/summarize") {
      try {
        const { text, title = null } = await request.json();
        if (!text || text.trim().length < 3) return json({ error: "Please provide some text." }, 400);

        const system = strictSystemPrompt();
        const chatModels = modelFallbackList();

        const { response: firstOut, model: usedModel } = await runWithFallback(
          env,
          chatModels,
          [
            { role: "system", content: system },
            { role: "user", content: "Title: " + (title || "Untitled") + "\nText:\n" + text }
          ],
          { temperature: 0, max_tokens: 360 }
        );

        let parsed = tryJson(firstOut);
        if (!isValidJson(parsed)) {
          const { response: repairedOut } = await runWithFallback(
            env,
            [usedModel],
            [
              { role: "system", content: repairSystemPrompt() },
              { role: "user", content: firstOut }
            ],
            { temperature: 0, max_tokens: 360 }
          );
          parsed = tryJson(repairedOut) || { note: firstOut };
        }

        // sanitize output
        parsed.bullets = clampBullets(parsed.bullets);
        parsed.actions = sanitizeActions(parsed.actions, text);

        // rebuild note if it's invalid or contains JSON/code
        if (!parsed.note || parsed.note.includes("{") || parsed.note.includes("```")) {
          parsed.note = buildMarkdownNote(parsed.summary, parsed.bullets, parsed.actions);
        }

        return json({ model_used: usedModel, ...parsed });
      } catch (e) {
        return json({ error: e.message || "Unknown error" }, 500);
      }
    }

    // ---------- Transcribe (Whisper) + summarize ----------
    if (request.method === "POST" && url.pathname === "/transcribe-summarize") {
      try {
        const form = await request.formData();
        const file = form.get("file");
        if (!file) return json({ error: "No audio file uploaded (field name must be 'file')." }, 400);

        // 1) Transcribe with Whisper Tiny (free)
        const whisperId = '@cf/openai/whisper-tiny-en';
        const bytes = new Uint8Array(await file.arrayBuffer());
        const whisperResp = await env.AI.run(whisperId, { audio: [...bytes] });
        const transcript = whisperResp?.text || whisperResp?.transcript || "";
        if (!transcript) return json({ error: "Transcription failed or returned empty text." }, 502);

        // 2) Summarize with fallback models
        const system = strictSystemPrompt();
        const chatModels = modelFallbackList();

        const { response: firstOut, model: usedModel } = await runWithFallback(
          env,
          chatModels,
          [
            { role: "system", content: system },
            { role: "user", content: transcript }
          ],
          { temperature: 0, max_tokens: 360 }
        );

        let parsed = tryJson(firstOut);
        if (!isValidJson(parsed)) {
          const { response: repairedOut } = await runWithFallback(
            env,
            [usedModel],
            [
              { role: "system", content: repairSystemPrompt() },
              { role: "user", content: firstOut }
            ],
            { temperature: 0, max_tokens: 360 }
          );
          parsed = tryJson(repairedOut) || { note: firstOut };
        }

        // sanitize output
        parsed.bullets = clampBullets(parsed.bullets);
        parsed.actions = sanitizeActions(parsed.actions, transcript);

        // rebuild note if invalid
        if (!parsed.note || parsed.note.includes("{") || parsed.note.includes("```")) {
          parsed.note = buildMarkdownNote(parsed.summary, parsed.bullets, parsed.actions);
        }

        return json({ model_used: usedModel, transcript, ...parsed });
      } catch (e) {
        return json({ error: e.message || "Unknown error" }, 500);
      }
    }

    return new Response("Not found", { status: 404 });
  }
};

// ---------- helpers ----------
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function tryJson(s) { try { return JSON.parse(s); } catch { return { note: s }; } }

function isValidJson(x) {
  return x && typeof x === "object" &&
         "summary" in x && "bullets" in x && "actions" in x && "note" in x;
}

function strictSystemPrompt() {
  return `You are a STRICT summarizer that outputs ONLY compact JSON.

Return EXACTLY this JSON schema:
{
  "summary": "≤18 words",
  "bullets": ["• short point", "• another", "• up to 5 items"],
  "actions": [{"task":"imperative verb", "due":"YYYY-MM-DD or null"}],
  "note": "Markdown with three sections: Summary, Key Points, Action Items. 60–120 words total."
}

Rules:
- NEVER include code fences or nested JSON in "note".
- "note" must be plain Markdown text, not JSON.
- Use ONLY user text; do not invent facts.
- **Never invent dates**. If no date, set "due" to null.
- Keep everything concise.`;
}

function repairSystemPrompt() {
  return `You convert text into valid JSON with schema:
{
  "summary":"one line",
  "bullets":["• item"],
  "actions":[{"task":"", "due":"YYYY-MM-DD or null"}],
  "note":"final markdown note"
}
Return ONLY JSON.`;
}

function modelFallbackList() {
  return [
    '@hf/nexusflow/starling-lm-7b-beta',
    '@cf/mistral/mistral-7b-instruct-v0.2-lora',
    '@hf/mistral/mistral-7b-instruct-v0.2',
    '@cf/meta/llama-3.1-8b-instruct'
  ];
}

async function runWithFallback(env, models, messages, opts = {}) {
  let lastErr, lastModel = null;
  for (const id of models) {
    try {
      const resp = await env.AI.run(id, {
        messages,
        temperature: 0,
        max_tokens: 360,
        ...opts
      });
      return { model: id, response: resp.response };
    } catch (e) {
      lastErr = e;
      lastModel = id;
    }
  }
  throw lastErr || new Error("All models failed (last tried: " + (lastModel || "none") + ")");
}

// ---- Post-process sanitizers ----
function sanitizeActions(actions, sourceText) {
  const hasDate = /\b(20\d{2}|19\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)\b/i.test(sourceText);
  return (Array.isArray(actions) ? actions : [])
    .slice(0, 4)
    .map(a => {
      const task = (a && a.task) ? String(a.task).trim() : "";
      let due = (a && a.due) ? String(a.due).trim() : null;
      if (!hasDate) due = null;
      return { task, due: due || null };
    });
}

function clampBullets(bullets) {
  return (Array.isArray(bullets) ? bullets : []).slice(0,5).map(b => {
    const s = String(b).trim();
    return s.startsWith("•") ? s : `• ${s}`;
  });
}

function ensureNoteLength(note) {
  return String(note || "");
}

// ---- Force Markdown Note if model misbehaves ----
function buildMarkdownNote(summary, bullets, actions) {
  const bulletLines = (bullets || []).map(b => `- ${b}`).join("\n");
  const actionLines = (actions || []).map(a => `- ${a.task} (due: ${a.due || "none"})`).join("\n");
  return `### Summary\n${summary}\n\n### Key Points\n${bulletLines}\n\n### Action Items\n${actionLines}`;
}
