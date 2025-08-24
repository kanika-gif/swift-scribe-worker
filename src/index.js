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
<p>
  <a href="/record">🎙️ Record (web app)</a> •
  <a href="/how">📱 iPhone Shortcut instructions</a>
</p>
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
<li>Save your Voice Memo to <b>Files</b> (Voice Memos → ••• → Save to Files).</li>
<li>Create a Shortcut:
  <ul>
    <li><b>Select File</b> (pick your .m4a)</li>
    <li><b>Get Contents of URL</b> → URL: <code>/transcribe-summarize</code> → Method: <b>POST</b> → Request Body: <b>Form</b> → Field <code>file = File</code></li>
    <li><b>Get Dictionary from Input</b></li>
    <li><b>Show Result</b> → key <code>note</code></li>
  </ul>
</li>
</ol>
<p>Or skip Shortcuts and use the web recorder at <a href="/record">/record</a>.</p>`,
        { headers: { "content-type": "text/html; charset=utf-8" }});
    }

    // ---------- Minimal Recorder UI (PWA-friendly) ----------
    if (request.method === "GET" && url.pathname === "/record") {
      return new Response(`<!doctype html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Swift-Scribe Recorder</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:16px;max-width:700px;margin:auto}
    button{padding:12px 14px;border-radius:10px;border:0;font-weight:600;margin-right:8px}
    #log{white-space:pre-wrap;background:#f6f7f9;padding:12px;border-radius:8px;margin-top:12px}
    audio{width:100%; margin-top:10px}
  </style>
</head>
<body>
  <h2>Swift-Scribe Recorder</h2>
  <p>Tap <b>Record</b>, then <b>Stop</b>, then <b>Upload</b> to transcribe + summarize.</p>
  <div>
    <button id="recBtn">🎙️ Record</button>
    <button id="stopBtn" disabled>⏹️ Stop</button>
    <button id="uploadBtn" disabled>⬆️ Upload</button>
  </div>
  <audio id="player" controls></audio>
  <div id="log">Ready.</div>

<script>
const recBtn = document.getElementById('recBtn');
const stopBtn = document.getElementById('stopBtn');
const uploadBtn = document.getElementById('uploadBtn');
const player = document.getElementById('player');
const log = (m)=>{ document.getElementById('log').textContent = m; };

let mediaRecorder, chunks = [], blob;

async function start() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';
    mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
    chunks = []; blob = null;

    mediaRecorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
      blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      player.src = URL.createObjectURL(blob);
      uploadBtn.disabled = false;
      log('Recorded '+Math.round(blob.size/1024)+' KB. Tap Upload to send.');
    };

    mediaRecorder.start();
    recBtn.disabled = true; stopBtn.disabled = false; uploadBtn.disabled = true;
    log('Recording… Speak now. Tap Stop when done.');
  } catch (e) {
    log('Mic error: ' + e.message);
  }
}

function stop() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    recBtn.disabled = false; stopBtn.disabled = true;
  }
}

async function upload() {
  if (!blob) return;
  log('Uploading…');
  const fd = new FormData();
  const file = new File([blob], 'recording.webm', { type: blob.type || 'audio/webm' });
  fd.append('file', file);
  try {
    const res = await fetch('/transcribe-summarize', { method: 'POST', body: fd });
    const j = await res.json();
    if (j.error) { log('Error: ' + j.error); return; }
    const note = j.note || '(no note)';
    const transcript = j.transcript ? ('\\n\\n— Transcript —\\n' + j.transcript) : '';
    log('— Summary —\\n' + note + transcript);
  } catch (e) {
    log('Upload failed: ' + e.message);
  }
}

recBtn.onclick = start;
stopBtn.onclick = stop;
uploadBtn.onclick = upload;
</script>
</body>
</html>`, { headers: { "content-type": "text/html; charset=utf-8" }});
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
          parsed = tryJson(repairedOut);
          if (!isValidJson(parsed)) {
            parsed = fallbackFromText(text);
          }
        }

        // Harden missing fields
        parsed.summary = parsed.summary || "Summary unavailable.";
        parsed.bullets = Array.isArray(parsed.bullets) ? parsed.bullets : [];
        parsed.actions = Array.isArray(parsed.actions) ? parsed.actions : [];

        // sanitize output
        parsed.bullets = clampBullets(parsed.bullets);
        parsed.actions = sanitizeActions(parsed.actions, text);

        // Always rebuild note into clean Markdown
        parsed.note = buildMarkdownNote(parsed.summary, parsed.bullets, parsed.actions);
        parsed.note = stripFakeDatesFromNote(parsed.note);

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

        const whisperId = '@cf/openai/whisper-tiny-en';
        const bytes = new Uint8Array(await file.arrayBuffer());
        const whisperResp = await env.AI.run(whisperId, { audio: [...bytes] });
        const transcript = whisperResp?.text || whisperResp?.transcript || "";
        if (!transcript) return json({ error: "Transcription failed or returned empty text." }, 502);

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
          parsed = tryJson(repairedOut);
          if (!isValidJson(parsed)) {
            parsed = fallbackFromText(transcript);
          }
        }

        // Harden missing fields
        parsed.summary = parsed.summary || "Summary unavailable.";
        parsed.bullets = Array.isArray(parsed.bullets) ? parsed.bullets : [];
        parsed.actions = Array.isArray(parsed.actions) ? parsed.actions : [];

        // sanitize output
        parsed.bullets = clampBullets(parsed.bullets);
        parsed.actions = sanitizeActions(parsed.actions, transcript);

        // Always rebuild note into clean Markdown
        parsed.note = buildMarkdownNote(parsed.summary, parsed.bullets, parsed.actions);
        parsed.note = stripFakeDatesFromNote(parsed.note);

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

// Order: Starling (HF) → Mistral (CF LoRA) → Mistral (HF) → Llama 3.1 8B (CF)
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

// Bullet-proof Markdown builder (never prints "undefined")
function buildMarkdownNote(summary, bullets, actions) {
  const s = (summary && String(summary).trim()) || "Summary unavailable.";
  const b = Array.isArray(bullets) ? bullets : [];
  const a = Array.isArray(actions) ? actions : [];

  const bulletLines = b.map(x => `- ${String(x).trim()}`).join("\n");
  const actionLines = a.map(x => `- ${x && x.task ? String(x.task).trim() : ""} (due: ${(x && x.due) || "none"})`).join("\n");

  return `### Summary
${s}

### Key Points
${bulletLines}

### Action Items
${actionLines}`;
}

// Guaranteed fallback builder when JSON is invalid
function fallbackFromText(raw) {
  const text = String(raw || "").replace(/\s+/g, " ").trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const summary = sentences[0]?.slice(0, 140) || "Transcript captured, summary unavailable.";
  const bullets = sentences.slice(0, 5).map(s => `• ${s.trim()}`);
  const actions = [{ task: "Review and extract key takeaways", due: null }];
  return {
    summary,
    bullets,
    actions,
    note: buildMarkdownNote(summary, bullets, actions)
  };
}

function stripFakeDatesFromNote(note) {
  if (!note) return "";
  return note.replace(/\b(?:by\s*)?(?:20\d{2}|19\d{2})([-/.]\d{1,2}([-/.]\d{1,2})?)?\b/gi, "");
}
