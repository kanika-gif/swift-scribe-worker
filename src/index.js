export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // -------- Home test page (text → summarize) --------
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Swift-Scribe</title></head>
<body>
<h3>Swift-Scribe</h3>
<p><a href="/how">How to POST audio</a></p>
<textarea id="t" rows="8" style="width:100%;"></textarea><br>
<input id="title" placeholder="Title (optional)" style="width:100%;margin:6px 0;"><br>
<button id="b">Summarize</button>
<pre id="o"></pre>
<script>
document.getElementById("b").onclick = async () => {
  const text = document.getElementById("t").value;
  const title = document.getElementById("title").value;
  document.getElementById("o").textContent = "…";
  const r = await fetch('/summarize', {
    method:'POST',
    headers:{'content-type':'application/json'},
    body: JSON.stringify({ text, title })
  });
  const j = await r.json();
  document.getElementById("o").textContent = (j.note || j.error || 'No output');
};
</script>
</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" }});
    }

    // -------- Help page --------
    if (request.method === "GET" && url.pathname === "/how") {
      return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<h3>Upload audio via Shortcut</h3>
<ol>
<li>Create a Shortcut:
  <ul>
    <li>Select File (pick a Voice Memo/audio)</li>
    <li>Get Contents of URL → POST → URL: /transcribe-summarize</li>
    <li>Request Body: Form → field name <code>file</code> = (Selected File)</li>
    <li>Get Dictionary from Input → Show Result (key: <code>note</code>)</li>
  </ul>
</li>
</ol>`, { headers: { "content-type": "text/html; charset=utf-8" }});
    }

    // -------- Text summarize endpoint (uses Mistral) --------
    if (request.method === "POST" && url.pathname === "/summarize") {
      try {
        const { text, title = null } = await request.json();
        if (!text || text.trim().length < 3) {
          return json({ error: "Please provide some text." }, 400);
        }

        const system = `You are a STRICT note formatter.
Output ONLY valid JSON exactly matching:
{
  "summary": "one line",
  "bullets": ["• item"],
  "actions": [{"task":"", "due": "YYYY-MM-DD or null"}],
  "note": "final markdown note"
}
Rules:
- Use only the user's details; do not invent.
- Preserve specifics (names/relationships).
- Avoid generic disclaimers unless the user asks.
- "note" is concise Markdown with Summary, Key Points, and Action Items.`;

        // 🔁 Choose model here (free):
        // const model = '@cf/meta/llama-3.1-8b-instruct'; // original
        const model = '@cf/mistral/mistral-7b-instruct-v0.2'; // better free choice

        const first = await env.AI.run(model, {
          messages: [
            { role: "system", content: system },
            { role: "user", content: "Title: " + (title || "Untitled") + "\\nText:\\n" + text }
          ],
          temperature: 0.1,
          max_tokens: 800
        });

        let parsed = tryJson(first.response);

        if (!parsed || typeof parsed !== "object" || !("note" in parsed)) {
          const repairSystem = `You convert text into valid JSON with schema:
{
  "summary":"one line",
  "bullets":["• item"],
  "actions":[{"task":"", "due":"YYYY-MM-DD or null"}],
  "note":"final markdown note"
}
Return ONLY JSON.`;
          const repaired = await env.AI.run(model, {
            messages: [
              { role: "system", content: repairSystem },
              { role: "user", content: first.response }
            ],
            temperature: 0,
            max_tokens: 600
          });
          parsed = tryJson(repaired.response) || { note: first.response };
        }

        return json(parsed);
      } catch (e) {
        return json({ error: e.message || "Unknown error" }, 500);
      }
    }

    // -------- Audio upload: transcribe (Whisper) + summarize (Mistral) --------
    if (request.method === "POST" && url.pathname === "/transcribe-summarize") {
      try {
        const form = await request.formData();
        const file = form.get("file");
        if (!file) return json({ error: "No audio file uploaded (field name must be 'file')" }, 400);

        // 1) Transcribe with Whisper Tiny (free)
        const whisper = "@cf/openai/whisper-tiny-en";
        const audioBytes = new Uint8Array(await file.arrayBuffer());

        const whisperResp = await env.AI.run(whisper, { audio: [...audioBytes] });
        const transcript = (whisperResp && (whisperResp.text || whisperResp.transcript || "")) || "";
        if (!transcript) return json({ error: "Transcription failed or returned empty text." }, 502);

        // 2) Summarize with Mistral (free)
        const system = `You are a STRICT note formatter.
Output ONLY valid JSON exactly matching:
{
  "summary": "one line",
  "bullets": ["• item"],
  "actions": [{"task":"", "due": "YYYY-MM-DD or null"}],
  "note": "final markdown note"
}
Rules:
- Use only the transcript; do not invent.
- Preserve specifics.
- Avoid generic disclaimers unless the user asks.
- "note" is concise Markdown with Summary, Key Points, and Action Items.`;
        const model = '@cf/mistral/mistral-7b-instruct-v0.2';

        const first = await env.AI.run(model, {
          messages: [
            { role: "system", content: system },
            { role: "user", content: transcript }
          ],
          temperature: 0.1,
          max_tokens: 800
        });

        let parsed = tryJson(first.response);
        if (!parsed || typeof parsed !== "object" || !("note" in parsed)) {
          const repaired = await env.AI.run(model, {
            messages: [
              { role: "system", content: `Return ONLY valid JSON with the required keys (summary, bullets, actions, note).` },
              { role: "user", content: first.response }
            ],
            temperature: 0,
            max_tokens: 600
          });
          parsed = tryJson(repaired.response) || { note: first.response };
        }

        return json({ transcript, ...parsed });
      } catch (e) {
        return json({ error: e.message || "Unknown error" }, 500);
      }
    }

    return new Response("Not found", { status: 404 });
  }
};

// ---- helpers ----
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
function tryJson(s) { try { return JSON.parse(s); } catch { return { note: s }; } }
