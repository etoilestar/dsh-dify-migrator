import semver from "semver"
import {
  TARGET_DIFY_VERSION,
  type DifyManifestIR,
  type DifyModelProviderIR,
  type MigrationIssue,
  type MigrationPlan,
} from "../domain.js"

export function classifyMigration(
  manifest: DifyManifestIR,
  targetDifyVersion = TARGET_DIFY_VERSION,
  modelProviders: readonly DifyModelProviderIR[] = [],
): MigrationPlan {
  const issues: MigrationIssue[] = []
  const targetPluginId = `dify_${slug(manifest.author)}_${slug(manifest.name)}_${slug(manifest.version)}`

  if (manifest.minimumDifyVersion && semver.valid(manifest.minimumDifyVersion) && semver.gt(manifest.minimumDifyVersion, targetDifyVersion)) {
    issues.push(issue("DIFY_VERSION_TOO_NEW", "error", `Requires Dify ${manifest.minimumDifyVersion}, newer than target ${targetDifyVersion}`))
    return { targetDifyVersion, targetPluginId, disposition: "incompatible", capabilities: manifest.capabilities, issues }
  }
  if (manifest.type !== "plugin") {
    issues.push(issue("PACKAGE_TYPE_UNSUPPORTED", "error", `Initial compiler accepts plugin packages, not ${manifest.type}`))
    return { targetDifyVersion, targetPluginId, disposition: "unsupported", capabilities: manifest.capabilities, issues }
  }
  if (manifest.capabilities.includes("unknown")) {
    issues.push(issue("CAPABILITY_UNKNOWN", "error", "No supported capability declarations were found"))
    return { targetDifyVersion, targetPluginId, disposition: "unsupported", capabilities: manifest.capabilities, issues }
  }

  const lifecycleCapabilities = manifest.capabilities.filter((kind) =>
    ["endpoint", "agent-strategy", "datasource", "trigger"].includes(kind),
  )
  if (lifecycleCapabilities.length > 0) {
    issues.push(issue("LIFECYCLE_ADAPTER_REQUIRED", "error", `No DSH lifecycle adapter yet for: ${lifecycleCapabilities.join(", ")}`))
    return { targetDifyVersion, targetPluginId, disposition: "unsupported", capabilities: manifest.capabilities, issues }
  }

  const toolOnly = manifest.capabilities.length === 1 && manifest.capabilities[0] === "tool"
  if (toolOnly && manifest.runner.language === "python") {
    issues.push(issue("ISOLATED_WORKER_REQUIRED", "warning", "Tool can enter the native DSH wrapper path; Python remains isolated implementation detail"))
    issues.push(issue("CREDENTIAL_REBIND_REQUIRED", "info", "Credentials are intentionally not migrated and must be rebound in DSH"))
    return { targetDifyVersion, targetPluginId, disposition: "wrapped-native", capabilities: manifest.capabilities, issues }
  }

  const modelOnly = manifest.capabilities.length === 1 && manifest.capabilities[0] === "model"
  if (modelOnly && modelProviders.length > 0 && modelProviders.every((provider) => provider.adapter === "xinference-openai-compatible")) {
    issues.push(issue("XINFERENCE_LLM_ADAPTER", "warning", "Xinference LLM models will use the native DSH OpenAI-compatible adapter"))
    issues.push(issue("CREDENTIAL_REBIND_REQUIRED", "info", "Server URL, model UID and API key are not migrated and must be rebound in DSH"))
    return { targetDifyVersion, targetPluginId, disposition: "wrapped-model", capabilities: manifest.capabilities, issues }
  }

  if (manifest.capabilities.includes("model")) {
    issues.push(issue("MODEL_ADAPTER_REQUIRED", "warning", "Model providers require dedicated streaming, usage, modality, and tool-call adapters"))
    return { targetDifyVersion, targetPluginId, disposition: "review-required", capabilities: manifest.capabilities, issues }
  }

  issues.push(issue("RUNNER_UNSUPPORTED", "error", `No compiler backend for runner language: ${manifest.runner.language ?? "unspecified"}`))
  return { targetDifyVersion, targetPluginId, disposition: "unsupported", capabilities: manifest.capabilities, issues }
}

function issue(code: string, severity: MigrationIssue["severity"], message: string): MigrationIssue {
  return { code, severity, message }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "unknown"
}

