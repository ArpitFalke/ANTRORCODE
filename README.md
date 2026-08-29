# ANTROR Code — describe it. ship it.

A browser-only AI coding studio for **vibe coders**, by **ANTROR**: you describe what you
want in plain language, a model writes complete files into a virtual workspace, and they
render live in a sandboxed preview. When it feels right, export the whole project as a ZIP.

No install. No build step. No backend. **Your API key never leaves your browser** — it is
stored in `localStorage` and requests go straight from your browser to the provider.

---

## Quick start

ANTROR Code is plain HTML/CSS/JS — serve the folder with any static server:

```bash
cd ANTRORCODE
python3 -m http.server 8899      # or: npx serve .
# open http://localhost:8899
```

(Opening `index.html` directly via double-click also works in most browsers, since there is no
build step.)

## Desktop app (like ZCode / Codex / Claude Code)

The same app ships as a real desktop app with native powers: the terminal runs commands on
your machine behind a permission dialog (no bridge needed) and every AI-generated project is
auto-saved into `~/ANTRORCode/<project>/` (or a folder you choose).

```bash
cd ANTRORCODE
npm install          # downloads Electron
npm start            # run the desktop app
npm run dist         # build installers → desktop-dist/ (.AppImage/.deb, .exe, .dmg)
```

In the browser version you get the same auto-save by picking a folder once
(⚙ Settings → General → Choose folder…) — Chrome/Edge write the files silently after every run.

1. Pick a provider and paste your API key (or choose **Ollama** to go key-free & local).
2. Describe what to build — e.g. *"a pastel landing page for my dog-walking side hustle"*.
3. Watch files stream in, tweak them in the **Code** tab, see it live in **Preview**.
4. **⬇ Export ZIP** when you're happy.

## Accounts (optional)

ANTROR Code works fully without an account. If you want cloud sync of your projects plus
**Continue with GitHub / Google**, connect your own Supabase project:

1. Create a (free) project at https://supabase.com.
2. Open **login.html** (sidebar → Settings → Account → **Connect**), paste your
   **Supabase URL** and **anon key**, and run the shown SQL once in the Supabase SQL editor
   (creates the `projects` table with row-level security).
3. In the Supabase dashboard → Authentication → Providers, enable **GitHub** and/or **Google**.
4. Sign in (`login.html`) or create an account (`register.html`). After that, the sidebar account box shows
   your avatar and projects can be pushed to / pulled from the cloud (☁ buttons in Projects).

Keys and projects stay in your browser either way — the Supabase anon key only grants access
to your own rows.

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
Z subscriptions) are **CLI products and don't expose a public API key**, so ANTROR Code
can't reuse them directly. The easiest equivalents:

- **API keys** from the same vendors above (metered, pay-per-token).
- **OpenRouter** — one key, hundreds of models, including `:free` ones.
- **Ollama** — completely free and local.
- Already running a local proxy/bridge for a subscription? Point **Custom endpoint** at it.

Model names are editable text — when vendors ship new models, just type the new name.

## What's inside

- **Terminal (antror cli)** — a real CLI over your project: `ls`, `cat`, `rm`, `cp`, `mv`,
  `grep`, `zip`, `history`, `restore`… and anything that isn't a command goes straight to
  the AI, Claude-Code style. Toggle with the `>_ Terminal` button or `Ctrl+\``.
  Built-in **git**: browser snapshots (`init/add/commit/log/checkout`) plus real GitHub
  remotes — `git clone <owner/repo>`, `git connect`, `git pull`, and `git push` with a
  personal-access token (`git token <pat>`, stored only locally).
- **Streaming chat** — tokens appear live; completed `<file path="…">…</file>` blocks are
  extracted mid-stream, so files land (and the preview refreshes) while the model types.
- **Virtual filesystem** — files persist in `localStorage`; built-in editor with line
  numbers and auto-save; every edit hot-reloads the preview.
- **Projects** — multiple projects, switch back and forth without losing the current work;
  optional cloud backup to your own Supabase. **Import folder** opens an existing project
  from your computer (text files — HTML/CSS/JS/MD/JSON… — binaries skipped).
- **Live preview** — local `<link>`/`<script>`/SVG refs are inlined into a sandboxed iframe
  (`srcdoc`, no same-origin). A shim also gives generated apps a safe in-memory
  `localStorage` so they never crash (nor touch your real storage). Console errors /
  `window.onerror` bubble up to the ⚠ badge over the preview.
- **Checkpoints** — a snapshot is captured before every AI run; restore any point from History.
- **Export** — ZIP download (JSZip fetched on demand) or pop the preview into a real tab.
- **Samples** — landing page / todo app / snake game to start from.
- **Legal** — Terms of Service & Privacy Policy at `legal.html`.

## Privacy & security

- Keys + projects live in your browser's `localStorage` only. Nothing is proxied or logged,
  and nothing is ever sent to ANTROR.
- Generated code runs in a sandboxed iframe **without same-origin**, and its storage access
  is shimmed in memory — generated apps cannot read your keys.
- Working on something sensitive? **⚙ Connect model → Forget key** erases the stored key.
- As with any AI-generated code, skim it before running it anywhere serious.

## Testing

`test/mock-llm.js` is a tiny OpenAI-compatible SSE mock so you can exercise the full
generate → stream → write-files → preview loop with zero keys:

```bash
node test/mock-llm.js &
# in ANTROR Code: ⚙ Connect model → Custom endpoint →
#   Base URL: http://localhost:8901/v1   Model: mock-1
```

## Known limits

- Markdown rendering in chat is intentionally minimal (code fences, bold, lists, headings).
- Binary assets aren't supported in the virtual FS (use data-URLs or SVG).
- Very large single files may hit `localStorage` quota — export a ZIP; the app warns you.
- Some providers block direct browser calls (CORS). OpenRouter, Groq, Gemini and Ollama are
  known to work; for others, put a tiny proxy in front or use the Custom endpoint.

---

A product by **ANTROR**. Built as a single static page: `index.html` · `styles.css` ·
`app.js` · `supabase.js` · `auth.html` · `legal.html`. Hack away. ✦
