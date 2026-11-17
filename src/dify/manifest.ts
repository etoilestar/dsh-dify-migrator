import { parse } from "yaml"
import type { DifyManifestIR, DifyPluginKind, RawDifyPackage } from "../domain.js"
import { MigrationError } from "../errors.js"

const CAPABILITY_KEYS: Array<{ kind: DifyPluginKind; keys: string[] }> = [
  { kind: "tool", keys: ["tools"] },
  { kind: "model", keys: ["models"] },
  { kind: "endpoint", keys: ["endpoints", "extensions"] },
  { kind: "agent-strategy", keys: ["agent_strategies", "agent-strategies", "agent_strategy"] },
  { kind: "datasource", keys: ["datasources"] },
  { kind: "trigger", keys: ["triggers"] },
]

export function parseDifyManifest(pkg: RawDifyPackage): DifyManifestIR {
  const source = pkg.textFiles.get("manifest.yaml") ?? pkg.textFiles.get("manifest.yml")
  if (!source) throw new MigrationError("MANIFEST_MISSING", "Package does not contain manifest.yaml")
  let value: unknown
  try {
    value = parse(source)
  } catch (error) {
    throw new MigrationError("MANIFEST_INVALID_YAML", "manifest.yaml is not valid YAML", error)
  }
  if (!isRecord(value)) throw new MigrationError("MANIFEST_INVALID", "manifest.yaml must contain a mapping")

  const author = requiredString(value.author, "author")
  const name = requiredString(value.name, "name")
  const version = requiredString(value.version, "version")
  const rawType = optionalString(value.type)
  const type: DifyManifestIR["type"] = rawType === "plugin" || rawType === "bundle" ? rawType : "unknown"
  const meta = isRecord(value.meta) ? value.meta : {}
  const runnerRaw = isRecord(meta.runner) ? meta.runner : {}
  const plugins = isRecord(value.plugins) ? value.plugins : {}
  const capabilityPaths: DifyManifestIR["capabilityPaths"] = {}

  for (const { kind, keys } of CAPABILITY_KEYS) {
    const paths = keys.flatMap((key) => stringArray(plugins[key]))
    if (paths.length > 0) capabilityPaths[kind] = [...new Set(paths)].sort()
  }

  const capabilities = Object.entries(capabilityPaths)
    .filter(([, paths]) => Array.isArray(paths) && paths.length > 0)
    .map(([kind]) => kind as DifyPluginKind)
    .sort()
  if (capabilities.length === 0) capabilities.push("unknown")

  return {
    type,
    author,
    name,
    version,
    packageId: `${author}/${name}:${version}@${pkg.sha256}`,
    schemaVersion: optionalString(meta.version),
    minimumDifyVersion: optionalString(meta.minimum_dify_version),
    runner: {
      language: optionalString(runnerRaw.language),
      version: optionalString(runnerRaw.version),
      entrypoint: optionalString(runnerRaw.entrypoint),
    },
    capabilityPaths,
    capabilities,
    permissions: flattenPermissions(value.resource),
  }
}

function flattenPermissions(resource: unknown): string[] {
  if (!isRecord(resource) || !isRecord(resource.permission)) return []
  const result: string[] = []
  for (const [group, groupValue] of Object.entries(resource.permission)) {
    if (!isRecord(groupValue)) continue
    for (const [name, enabled] of Object.entries(groupValue)) {
      if (enabled === true) result.push(`${group}.${name}`)
    }
  }
  return result.sort()
}

function requiredString(value: unknown, field: string): string {
  const text = optionalString(value)
  if (!text) throw new MigrationError("MANIFEST_INVALID", `manifest.yaml field is required: ${field}`)
  return text
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

