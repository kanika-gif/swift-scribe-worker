export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ---------- Root: simple UI ----------
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
<h3>Swift-Scribe</h3>
<p><a href="/how">How to POST audio from iPhone</a></p>
<textarea id="t" placeholder="Paste or type text to summarize…"></textarea><br>
<input id="title" placeholder="Title (optional)" style="margin:6px 0;"><br>
<button id="b">Summarize</button>
<pre id="o"></pre>
<script>
const b=document.getElementById("b"), o=document.getElementById("o");
b.onclick = async () => {
  const text = document.getElementById("t").value;
  const title = document.getElementById("title").value;
  o.textContent = "…";
  const r = await fetch('/summarize', {
    method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({ text, title })
  });
  const j = await r.json();
  o.textContent = j.note || j.error || 'No output';
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
    <li><b>Get Dictionary from Input</b> → <b>Show Result</b> of key <code>note</code></li>
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

        // Try CF Mistral LoRA → HF Mistral → Llama 3.1 8B (free)
        const chatModels = [
          '@cf/mistral/mistral-7b-instruct-v0.2-lora',
          '@hf/mistral/mistral-7b-instruct-v0.2',
          '@cf/meta/llama-3.1-8b-instruct'
        ];

        const { response: firstOut, model: usedModel } = await runWithFallback(env, chatModels, [
          { role: "system", content: system },
          { role: "user", content: "Title: " + (title || "Untitled") + "\nText:\n" + text }
        ]);

        let parsed = tryJson(firstOut);

        if (!isValidJson(parsed)) {
          const { response: repairedOut } = await runWithFallback(env, [usedModel], [
            { role: "system", content: repairSystemPrompt() },
            { role: "user", content: firstOut }
          ], { temperature: 0, max_tokens: 600 });
          parsed = tryJson(repairedOut) || { note: firstOut };
        }

        return json(parsed);
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
        const whisperId = '@cf/openai/whisper-tiny-en'; // confirm in your dashboard
        const bytes = new Uint8Array(await file.arrayBuffer());
        const whisperResp = await env.AI.run(whisperId, { audio: [...bytes] });
        const transcript = whisperResp?.text || whisperResp?.transcript || "";
        if (!transcript) return json({ error: "Transcription failed or returned empty text." }, 502);

        // 2) Summarize with model fallback
        const system = strictSystemPrompt();
        const chatModels = [
          '@cf/mistral/mistral-7b-instruct-v0.2-lora',
          '@hf/mistral/mistral-7b-instruct-v0.2',
          '@cf/meta/llama-3.1-8b-instruct'
        ];

        const { response: firstOut, model: usedModel } = await runWithFallback(env, chatModels, [
          { role: "system", content: system },
          { role: "user", content: transcript }
        ]);

        let parsed = tryJson(firstOut);
        if (!isValidJson(parsed)) {
          const { response: repairedOut } = await runWithFallback(env, [usedModel], [
            { role: "system", content: repairSystemPrompt() },
            { role: "user", content: firstOut }
          ], { temperature: 0, max_tokens: 600 });
          parsed = tryJson(repairedOut) || { note: firstOut };
        }

        return json({ transcript, ...parsed });
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
  return `You are a STRICT note formatter.
Output ONLY valid JSON exactly matching:
{
  "summary": "one line",
  "bullets": ["• item"],
  "actions": [{"task":"", "due": "YYYY-MM-DD or null"}],
  "note": "final markdown note"
}
Rules:
- Use ONLY the user's details; do not invent.
- Preserve specifics (names/relationships).
- Avoid generic disclaimers unless explicitly requested.
- "note" is concise Markdown with Summary, Key Points, and Action Items.`;
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

async function runWithFallback(env, models, messages, opts = {}) {
  let lastErr;
  for (const id of models) {
    try {
      const resp = await env.AI.run(id, {
        messages,
        temperature: 0.1,
        max_tokens: 800,
        ...opts
      });
      return { model: id, response: resp.response };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("All models failed");
}
