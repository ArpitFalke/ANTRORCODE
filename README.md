# ◆ VibeForge — describe it. ship it.

A browser-only AI coding studio for **vibe coders**: you describe what you want in plain
language, a model writes complete files into a virtual workspace, and they render live in a
sandboxed preview. When it feels right, export the whole project as a ZIP.

No install. No build step. No backend. **Your API key never leaves your browser** — it is
stored in `localStorage` and requests go straight from your browser to the provider.

---

## Quick start

VibeForge is plain HTML/CSS/JS — serve the folder with any static server:

```bash
cd vibeforge
python3 -m http.server 8899      # or: npx serve .
# open http://localhost:8899
```

(Opening `index.html` directly via double-click also works in most browsers, since there is no
build step.)

1. Pick a provider and paste your API key (or choose **Ollama** to go key-free & local).
2. Describe what to build — e.g. *"a pastel landing page for my dog-walking side hustle"*.
3. Watch files stream in, tweak them in the **Code** tab, see it live in **Preview**.
4. **⬇ Export ZIP** when you're happy.

---

## Providers (bring your own key)

| Provider | Default model | Get a key |
|---|---|---|
| Z.ai · GLM | `glm-4.6` | https://z.ai/manage-apikey/apikey-list |
| Anthropic · Claude | `claude-sonnet-4-5` | https://console.anthropic.com/settings/keys |
| OpenAI · GPT | `gpt-5` | https://platform.openai.com/api-keys |
| OpenRouter | `z-ai/glm-4.6` | https://openrouter.ai/settings/keys |
| Google · Gemini | `gemini-2.5-flash` | https://aistudio.google.com/app/apikey |
| Groq | `llama-3.3-70b-versatile` | https://console.groq.com/keys |
| Ollama (local, free) | `qwen2.5-coder:7b` | run `ollama serve`, then just connect |
| Custom endpoint | any | any OpenAI-compatible `/chat/completions` URL |

Notes on the "paid plans" question: subscription logins (Claude Code, ChatGPT/Codex,
Z subscriptions) are **CLI products and don't expose a public API key**, so VibeForge can't
reuse them directly. The easiest equivalents:

- **API keys** from the same vendors above (metered, pay-per-token).
- **OpenRouter** — one key, hundreds of models, including `:free` ones.
- **Ollama** — completely free and local.
- Already running a local proxy/bridge for a subscription? Point **Custom endpoint** at it.

Model names are editable text — when vendors ship new models, just type the new name.

## What's inside

- **Streaming chat** — tokens appear live; completed `<file path="…">…</file>` blocks are
  extracted mid-stream, so files land (and the preview refreshes) while the model types.
- **Virtual filesystem** — files persist in `localStorage`; built-in editor with line
  numbers and auto-save; every edit hot-reloads the preview.
- **Live preview** — local `<link>`/`<script>`/SVG refs are inlined into a sandboxed iframe
  (`srcdoc`, no same-origin). A shim also gives generated apps a safe in-memory
  `localStorage` so they never crash (nor touch your real storage). Console errors /
  `window.onerror` bubble up to the ⚠ badge over the preview.
- **Checkpoints** — a snapshot is captured before every AI run; restore any point from ⏱ History.
- **Export** — ZIP download (JSZip fetched on demand) or pop the preview into a real tab.
- **Samples** — landing page / todo app / snake game to start from.

## Privacy & security

- Keys + projects live in your browser's `localStorage` only. Nothing is proxied or logged.
- Generated code runs in a sandboxed iframe **without same-origin**, and its storage access
  is shimmed in memory — generated apps cannot read your keys.
- Working on something sensitive? **⚙ Connect model → Forget key** erases the stored key.
- As with any AI-generated code, skim it before running it anywhere serious.

## Testing

`test/mock-llm.js` is a tiny OpenAI-compatible SSE mock so you can exercise the full
generate → stream → write-files → preview loop with zero keys:

```bash
node test/mock-llm.js &
# in VibeForge: ⚙ Connect model → Custom endpoint →
#   Base URL: http://localhost:8901/v1   Model: mock-1
```

## Known limits

- Markdown rendering in chat is intentionally minimal (code fences, bold, lists, headings).
- Binary assets aren't supported in the virtual FS (use data-URLs or SVG).
- Very large single files may hit `localStorage` quota — export a ZIP; the app warns you.
- Some providers block direct browser calls (CORS). OpenRouter, Groq, Gemini and Ollama are
  known to work; for others, put a tiny proxy in front or use the Custom endpoint.

---

Built as a single static page: `index.html` · `styles.css` · `app.js`. Hack away. ✦
