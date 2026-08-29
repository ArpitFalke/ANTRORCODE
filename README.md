<div align="center">

<img src="assets/logo.png" width="96" alt="ANTROR Code" />

# ANTROR Code

**describe it. ship it.**

The AI coding studio for **vibe coders** — describe what you want in plain language,
watch real files stream in, render live, and ship. A product by **ANTROR**.

[![Download](https://img.shields.io/badge/Download-all%20platforms-e8e8e8?style=for-the-badge&labelColor=0a0a0a)](https://antrorcode.vercel.app/download)
[![Web app](https://img.shields.io/badge/Web-open%20the%20studio-e8e8e8?style=for-the-badge&labelColor=0a0a0a)](https://antrorcode.vercel.app)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20Web-e8e8e8?style=for-the-badge&labelColor=0a0a0a)](#-get-the-app)

</div>

---

No install. No build step. No backend. **Your API key never leaves your browser** — it is stored in
`localStorage` and requests go straight from your browser to the provider. Nothing is ever sent to ANTROR.

## ✨ What it does

| | |
|---|---|
| 💬 **Vibe chat** | Describe an app in plain words — complete files stream into the workspace while the model types. |
| 🧠 **Reasoning** | The AI *thinks* before it builds — Off / Balanced / Deep, using each model's native thinking (GLM, Claude, Gemini, GPT-5, OpenRouter). |
| ⚡ **Live preview** | A sandboxed runtime refreshes as files land. Phone-width preview included. |
| 📝 **Diff view** | Every AI run shows exactly where code was **added** and **removed** — `+48 −3`, line by line. |
| 🖥️ **Real terminal** | A CLI over your project: `ls`, `cat`, `grep`, `git clone/push/pull`… plus `!<command>` to run real commands on your device — always behind a permission dialog. |
| 🤖 **AI in the loop** | Anything that isn't a command goes straight to the model, with a live activity feed: *thinking → writing files → done*. |
| 💾 **Auto-save to device** | Generated projects land on your disk automatically, like a real IDE. |
| 🗂️ **Projects** | Unlimited projects, non-destructive switching, checkpoints before every run, optional cloud sync via your own Supabase. |
| 📊 **Usage** | Token counts per provider — see exactly what each model consumed. |
| 🔐 **Accounts** | Email + **Continue with GitHub / Google**, on your own Supabase. |

## 🚀 Quick start (web — zero install)

```bash
git clone https://github.com/ArpitFalke/ANTRORCODE.git
cd ANTRORCODE
node serve.js                    # clean-URL dev server (zero dependencies)
# open http://localhost:8899
```

1. Pick a provider and paste your API key — or choose **Ollama** to go key-free & local.
2. Describe what to build — *"a pastel landing page for my dog-walking side hustle"*.
3. Watch files stream in, tweak them in **Code**, see it live in **Preview**.
4. **Export ZIP** when it feels right.

## 📥 Get the app

One link to share anywhere: **[antrorcode.vercel.app/download](https://antrorcode.vercel.app/download)**

<div align="center">

| | | |
|---|---|---|
| <img src="https://cdn.jsdelivr.net/npm/simple-icons@9/icons/windows.svg" width="34" alt="Windows"/> | **Windows** | `.exe` installer (64-bit). Windows may show *"Windows protected your PC"* for unsigned apps — click **More info → Run anyway**. Verify against the release's `SHA256SUMS.txt`. |
| <img src="https://cdn.jsdelivr.net/npm/simple-icons@13/icons/apple.svg" width="34" alt="macOS"/> | **macOS** | `.dmg` for Apple Silicon & Intel. If Gatekeeper hesitates: right-click the app → **Open** (first launch only). |
| <img src="https://cdn.jsdelivr.net/npm/simple-icons@13/icons/linux.svg" width="34" alt="Linux"/> | **Linux** | `.AppImage` — `chmod +x` and run, no install needed. Or `.deb` for Debian/Ubuntu/Mint (`sudo dpkg -i`). x64. |
| <img src="https://cdn.jsdelivr.net/npm/simple-icons@13/icons/android.svg" width="34" alt="Android"/> | **Android** | Installable app — open the site in Chrome → menu → **Install app**. Or build a signed `.apk` via PWABuilder from the download page. |
| <img src="https://cdn.jsdelivr.net/npm/simple-icons@13/icons/googlechrome.svg" width="34" alt="Web"/> | **Web** | Nothing to install — [open the studio](https://antrorcode.vercel.app). Works offline after your first visit (PWA). |

</div>

Installers are built automatically for every version tag by GitHub Actions
(`.github/workflows/desktop.yml`) and attached to the
[**Releases**](https://github.com/ArpitFalke/ANTRORCODE/releases/latest) page with SHA256 checksums.

> **Why ~90 MB?** The desktop app bundles its own complete browser engine (Chromium) so it runs
> identically on every machine with zero dependencies — the same reason VS Code, Slack and Discord
> weigh the same. On older hardware, the Web version in a browser is the lighter option.

## 🖥️ Run the desktop app locally

```bash
npm install       # downloads Electron
npm start         # opens ANTROR Code as a native window
npm run dist      # builds installers into desktop-dist/
```

The desktop app adds native powers: the terminal runs real commands behind a permission
dialog (no bridge needed) and every project auto-saves to `~/ANTRORCode/`.

## 🔌 Providers (bring your own key)

| Provider | Default model | Get a key |
|---|---|---|
| Z.ai · GLM | `glm-4.6` | [z.ai](https://z.ai/manage-apikey/apikey-list) |
| Anthropic · Claude | `claude-sonnet-4-5` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| OpenAI · GPT | `gpt-5` | [platform.openai.com](https://platform.openai.com/api-keys) |
| OpenRouter | `z-ai/glm-4.6` | [openrouter.ai](https://openrouter.ai/settings/keys) |
| Google · Gemini | `gemini-2.5-flash` | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| Groq | `llama-3.3-70b-versatile` | [console.groq.com](https://console.groq.com/keys) |
| NVIDIA NIM | `meta/llama-3.3-70b-instruct` | [build.nvidia.com](https://build.nvidia.com) |
| Ollama (local, free) | `qwen2.5-coder:7b` | run `ollama serve`, just connect |
| Custom endpoint | any | any OpenAI-compatible `/chat/completions` URL |

Subscription logins (Claude Code, ChatGPT/Codex, Z subscriptions) are CLI products and don't
expose public API keys — use **API keys**, **OpenRouter** (one key → hundreds of models), or
**Ollama** (free, local) instead. Point **Custom endpoint** at any local proxy.

## 🔐 Accounts & cloud sync (optional)

The studio works fully without an account. For sync + GitHub/Google sign-in, connect **your own
Supabase** (free): open **Settings → User**, paste your Project URL + anon key, run the shown SQL
once, and enable the GitHub/Google providers in the Supabase dashboard. Keys and projects stay in
your browser either way.

## 🔒 Privacy & security

- Keys + projects live in your browser's `localStorage` only — never proxied, never logged, never sent to ANTROR.
- Generated code runs in a sandboxed iframe **without same-origin**; its storage is an in-memory shim — generated apps cannot read your keys.
- Device commands (terminal `!`) **always ask first** — a permission dialog shows the exact command before anything runs.
- As with any AI-generated code, skim it before running it anywhere serious.

## 🧪 Testing with zero keys

```bash
node test/mock-llm.js &
# in the studio: Settings → Model → Custom endpoint →
#   Base URL: http://localhost:8901/v1   Model: mock-1
```

## 📁 Project structure

```
ANTRORCODE/
├── index.html · styles.css · app.js     ← the studio (single-page, no build)
├── terminal.js                          ← antror cli (shell + AI + git)
├── settings.html · login.html · register.html · legal.html · download.html
├── supabase.js · supabase-config.js     ← auth + cloud projects
├── main.js · preload.js · package.json  ← desktop app (Electron)
├── manifest.json · sw.js                ← installable web app (Android + desktop PWA)
├── bridge/bridge.js                     ← optional device bridge for browser mode
└── .github/workflows/desktop.yml        ← builds installers for every OS on tag
```

## 📄 License

MIT © 2026 **ANTROR**. All rights reserved where applicable.

<div align="center">

**describe it. ship it.** — a product by **ANTROR**

</div>
