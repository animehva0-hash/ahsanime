---
name: rea
description: Reverse Engineer Anything — agent skill backed by the morluto/rea MCP toolkit. Inspects JS/Electron apps, websites, native binaries (Hopper/Ghidra/IDA), .NET, Android APKs, firmware, WASM, EVM and more, returning evidence (code, references, unknowns). Install via `npx rea-agents setup`, skill source `https://skills.sh/morluto/rea/reverse-engineer-anything`.
---

# REA SKILL — REVERSE ENGINEER ANYTHING

## What this skill is
REA (`morluto/rea`, npm `rea-agents`) is an MCP-based reverse-engineering toolkit for agents.
It does **not** need the target's source code: it inspects app behavior / runtime artifacts
and returns **evidence** (real code snippets, instruction references, decoded payloads,
and an explicit "unknowns" list). Analysis runs locally and is lawful-use / authorized-target only.

## How the agent uses it
- Install: `npx rea-agents setup` (registers the MCP server + workflow instructions; picks
  Claude Code / Codex / Cursor / Gemini CLI / Grok Build). Skill-only install supported too.
- Skill source used here: `https://skills.sh/morluto/rea/reverse-engineer-anything`.
- Prompt pattern: `Understand how X works in <target>, show me the evidence, and build a
  similar feature for my project.` REA traces the relevant code; the agent uses results to
  explain, implement and test.
- Terminal entry: `npx -y rea-agents@latest analyze-javascript-application /abs/path --json`
  (also `rea`, `rea update`).

## Target catalog (what REA can analyze)
| Target | Returns | Requirements |
|---|---|---|
| Native binaries | pseudocode, assembly, strings, symbols, calls, references | Hopper / Ghidra / IDA (caller license) |
| Offline ELF layout | sections, segments, symbols, relocations | pwntools on Linux x64 |
| Go / Rust binaries | module versions, crate deps (cargo-auditable) | built-in static ELF/PE/thin Mach-O, no Go/Rust needed |
| WASM artifact | sections, import/export WAT, decoded WAT | WABT 1.0.42 |
| EVM bytecode | dispatch selectors, arg offsets, mutability | local raw/hex on Linux x64 |
| SQLite DBs | tables, columns, indexes, views, sample rows | Node.js 24.15+/26+ |
| JavaScript / Electron | modules, imports, source maps, routes, IPC, native add-ons | Node.js + npm; Linux needs procps `ps` |
| Websites | page structure, scripts, network observations, screenshots | Chrome-family browser |
| Saved network captures | requests, responses, exposed payloads, source locs | HAR or SAZ; mitmdump on Linux |
| .NET assemblies | metadata, CIL, native deps | none (static) |
| Android APKs | manifest, classes, decompiled methods | headless JADX + JDK |
| Android devices | devices, packages, procs, logs, screen, APK push/pull | caller adb |
| JEB projects | units, digests, types | JEB MCP server |
| Android resources | decoded manifest, strings, locales | caller Apktool |
| Flutter apps | snapshot hash, per-ABI lib digests, engine build | static APK parse |
| Firmware | regions, extraction, native handoffs | Binwalk / Unblob |
| Recorded Linux crashes | registers, signals, mapping candidates | pwntools + optional GDB/pwndbg |
| Recorded packets | endpoints, DNS, TLS SNI, HTTP requests | tshark 4.x + prlimit |
| Packet summaries | endpoints, DNS, TLS SNI, protocol dist, HTTP | caller tshark + capinfos |
| Recorded logic signals | decoder annotations, sample ranges | sigrok-cli 0.7.2 |
| macOS Apple apps / bundles | file inventory, digests, plists, bundle anatomy | see Apple guide |
| Process behavior | terminal output, exit code, fs observations | Linux/macOS PTY |

## Static vs runtime
- **Static** inspection (JS/.NET, offline ELF/Go/Rust, WASM, firmware) reads files without
  running the target — safe to run in CI/sandbox.
- **Runtime** capture (websites via browser, device/emulator interaction, packet/log/process
  capture) executes or observes the target under your user permissions. Each runtime guide
  documents exactly what it does.

## Evidence-first principle
Every finding comes with its evidence and limitations. Use this to:
1. Pin the exact source location / instruction / payload that matters.
2. Spot where the trace stops (unknowns) and decide the next probe.
3. Verify any reconstruction against the original (e.g., the DX-Ball case study
   passed 3,205 original-x86 cases; TH04 angle math recovered from 16-bit PC-98).

## How to get better / teach this skill
- Prefer a **Chrome-family browser** target for websites (the trickiest case — JS is rendered
  and streams often live behind obfuscated `window.__P` blobs or client-only APIs). Always
  grab the deobfuscation function (e.g. `core/obfuscate.js`) alongside the embed page.
- For **native** targets, pair with Hopper (REA can auto-install Hopper after approval; Ghidra
  and IDA use your existing installs). Raise `REA_GHIDRA_STARTUP_TIMEOUT_MS` /
  `REA_HOPPER_STARTUP_TIMEOUT_MS` for large binaries.
- Contribute via Issues / PRs. Follow `CONTRIBUTING.md`, run the verification lanes in
  `docs/testing.md`, and reference `docs/architecture.mermaid` for structure.
- When teaching others: stress **responsibility** — REA is for software you own or are
  authorized to examine; never reverse commercial assets without permission.

## Status note for THIS repo
REA is the right tool for the streaming-site deep-dives that resist static curl, e.g. the
JS-rendered player APIs and the obfuscated `window.__P` payloads referenced by the anime
streams under investigation.
