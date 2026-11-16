/**
 * Server-side runtime configuration.
 *
 * Resolution order for every key:
 *   1. process.env            (Vercel / Docker / CI — always preferred)
 *   2. secrets.local.json     (local fallback so a wiped .env never breaks the app)
 *
 * Only ever imported from server code, so nothing here reaches the browser.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

type Secrets = Record<string, string>;

const g = globalThis as unknown as { __na_secrets?: Secrets };

function loadFile(): Secrets {
  try {
    const raw = readFileSync(path.join(process.cwd(), "secrets.local.json"), "utf8");
    const parsed = JSON.parse(raw) as Secrets;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function secrets(): Secrets {
  return (g.__na_secrets ??= loadFile());
}

/** Read a configuration value from env first, then the local secrets file. */
export function runtimeConfig(key: string): string | undefined {
  const fromEnv = process.env[key]?.trim();
  if (fromEnv) return fromEnv;
  const fromFile = secrets()[key]?.trim();
  return fromFile || undefined;
}

/** Where a value came from — useful for the health endpoint. */
export function configSource(key: string): "env" | "file" | "missing" {
  if (process.env[key]?.trim()) return "env";
  if (secrets()[key]?.trim()) return "file";
  return "missing";
}
