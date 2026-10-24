# RPA Agent Platform

**Enterprise Local-First Desktop RPA & Autonomous Agent Engine**

A privacy-first, desktop-native Robotic Process Automation platform that combines headless browser automation with autonomous AI agents. Built on Tauri v2 for a lightweight, secure desktop shell with a React frontend and Python-powered AI backend.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Tauri v2 Desktop Shell                  │
│  ┌───────────────────────┐   ┌────────────────────────────┐ │
│  │    React Frontend     │   │     Rust Core (IPC)        │ │
│  │  - Dashboard UI       │◄─►│  - Window management       │ │
│  │  - Workflow editor    │   │  - File-system access      │ │
│  │  - Agent monitor      │   │  - Keyring integration     │ │
│  │  - Settings / BYOK    │   │  - Sidecar lifecycle       │ │
│  └───────────────────────┘   └─────────┬──────────────────┘ │
│                                        │ stdio / gRPC       │
│  ┌─────────────────────────────────────▼──────────────────┐ │
│  │              Python Sidecar Process                    │ │
│  │  - LangGraph agent orchestration                      │ │
│  │  - Gemini API integration (BYOK)                      │ │
│  │  - Playwright headless browser automation             │ │
│  │  - Ethical guardrails & action classifier             │ │
│  │  - Workflow execution engine                          │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

| Layer          | Technology                       |
| -------------- | -------------------------------- |
| Desktop shell  | Tauri v2 (Rust)                  |
| Frontend       | React 18, Tailwind CSS, Zustand  |
| Agent engine   | Python 3.11+, LangGraph          |
| LLM provider   | Google Gemini API (BYOK)         |
| Automation     | Playwright (headless Chromium)   |
| IPC            | Tauri commands + stdio sidecar   |

---

## Key Features

- **🏠 Local-First** — All data stays on your machine. No cloud dependency, no telemetry.
- **🔑 BYOK (Bring Your Own Key)** — Supply your own Gemini API key; stored securely in the OS keyring.
- **🧑‍✈️ HITL (Human-in-the-Loop)** — Agents pause and request approval before sensitive or irreversible actions.
- **⚡ Zero-CLI Bootstrap** — One-click setup; the app provisions its own Python virtual environment and dependencies.
- **🌐 Headless Automation** — Playwright-driven browser workflows that run entirely in the background.
- **🛡️ Ethical Guardrails** — Built-in action classifier that blocks unsafe, disallowed, or ambiguous operations.

---

## Directory Structure

```
rpa-agent-platform/
├── index.html                  # Tauri webview entry point
├── package.json                # Node dependencies & scripts
├── vite.config.js              # Vite dev-server config (port 1420)
├── tailwind.config.js          # Tailwind theme & content paths
├── postcss.config.js           # PostCSS plugin chain
├── README.md                   # ← You are here
│
├── src/                        # React frontend source
│   ├── main.jsx                # React 18 createRoot entry
│   ├── index.css               # Tailwind directives & base styles
│   ├── App.jsx                 # Root application component
│   ├── components/             # Reusable UI components
│   │   ├── layout/             #   Shell, Sidebar, TopBar
│   │   ├── dashboard/          #   Status cards, metrics
│   │   ├── workflow/           #   Workflow editor & cards
│   │   └── shared/             #   Buttons, modals, badges
│   ├── stores/                 # Zustand state stores
│   ├── services/               # Tauri IPC & API bridges
│   └── utils/                  # Helpers, constants, formatters
│
├── src-tauri/                  # Rust / Tauri backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── src/
│   │   └── main.rs             # Tauri commands & window setup
│   └── icons/                  # App icons
│
└── python_sidecar/             # Python agent engine
    ├── pyproject.toml
    ├── main.py                 # Sidecar entry point (stdio IPC)
    ├── agent/                  # LangGraph agent definitions
    ├── automation/             # Playwright browser automation
    ├── guardrails/             # Ethical classifier & policy engine
    └── tools/                  # Agent tool implementations
```

---

## Prerequisites

| Requirement    | Version   | Notes                                    |
| -------------- | --------- | ---------------------------------------- |
| **Rust**       | latest    | Install via [rustup.rs](https://rustup.rs) |
| **Node.js**    | 20+       | LTS recommended                          |
| **Python**     | 3.11+     | Required for the agent sidecar           |
| **Playwright** | (auto)    | Installed automatically by the sidecar   |

---

## Quick Start

```bash
# 1. Clone the repository
git clone <repo-url> rpa-agent-platform
cd rpa-agent-platform

# 2. Install frontend dependencies
npm install

# 3. Launch the Tauri dev environment (starts Vite + Rust + sidecar)
npm run tauri dev
```

> **First run:** Tauri will compile the Rust backend (~2-4 min on first build).
> The Python sidecar's virtual environment is provisioned automatically on launch.

---

## Security Model

### 🔑 Bring Your Own Key (BYOK)

The platform **never** ships with, stores plaintext, or transmits API keys to any third-party server. Users provide their own Gemini API key through the Settings UI. The key is persisted in the operating system's native credential store:

| OS      | Backend                        |
| ------- | ------------------------------ |
| macOS   | Keychain                       |
| Windows | Windows Credential Manager     |
| Linux   | libsecret (GNOME Keyring)      |

### 🛡️ Ethical Classifier

Before any agent-initiated action is executed, it passes through a multi-layer classification pipeline:

1. **Static rule engine** — Blocks known-dangerous patterns (e.g., `rm -rf /`, credential exfiltration).
2. **LLM-based classifier** — Evaluates novel actions against a safety policy prompt.
3. **HITL gate** — High-risk actions surface an approval dialog to the user before proceeding.

Actions are categorized as:

| Category      | Behavior                                     |
| ------------- | -------------------------------------------- |
| ✅ `SAFE`      | Executed immediately                         |
| ⚠️ `REVIEW`   | Queued for human approval (HITL)             |
| 🚫 `BLOCKED`  | Rejected outright; logged for audit          |

### 🔒 Sandboxing

- The Tauri shell runs with minimal OS permissions (no full disk access by default).
- The Python sidecar operates inside an isolated virtual environment.
- Playwright browsers launch in headless mode with `--disable-extensions` and `--no-sandbox` disabled.

---

## License

[MIT](LICENSE) — Copyright © 2024 RPA Agent Platform Contributors
