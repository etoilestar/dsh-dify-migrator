import { readdir, stat } from "node:fs/promises"
import { extname, resolve } from "node:path"
import {
  REPORT_SCHEMA_VERSION,
  TARGET_DIFY_VERSION,
  type BatchMigrationReport,
  type BatchPackageRecord,
  type MigrationDisposition,
} from "./domain.js"
import { MigrationError } from "./errors.js"
import { readDifyPackage } from "./dify/package-reader.js"
import { parseDifyManifest } from "./dify/manifest.js"
import { parseToolProviders } from "./dify/tool-provider.js"
import { parseModelProviders } from "./dify/model-provider.js"
import { classifyMigration } from "./migration/classifier.js"

export async function scanDifyPackages(inputs: readonly string[]): Promise<BatchMigrationReport> {
  const normalizedInputs = [...new Set(inputs.map((input) => resolve(input)))].sort()
  const packagePaths = await discoverPackagePaths(normalizedInputs)
  const packages: BatchPackageRecord[] = []
  const firstByHash = new Map<string, string>()

  for (const sourcePath of packagePaths) {
    try {
      const pkg = await readDifyPackage(sourcePath)
      const duplicateOf = firstByHash.get(pkg.sha256)
      if (!duplicateOf) firstByHash.set(pkg.sha256, sourcePath)
      const manifest = parseDifyManifest(pkg)
      const toolProviders = manifest.capabilities.includes("tool") ? parseToolProviders(pkg, manifest) : undefined
      const modelProviders = manifest.capabilities.includes("model") ? parseModelProviders(pkg, manifest) : undefined
      packages.push({
        sourcePath,
        sha256: pkg.sha256,
        ...(duplicateOf ? { duplicateOf } : {}),
        manifest,
        ...(toolProviders ? { toolProviders } : {}),
        ...(modelProviders ? { modelProviders } : {}),
        plan: classifyMigration(manifest, TARGET_DIFY_VERSION, modelProviders),
        package: {
          byteLength: pkg.byteLength,
          entryCount: pkg.entries.length,
          signatureEnvelopePresent: pkg.signatureEnvelope !== undefined,
          signatureVerification: "not-verified",
        },
      })
    } catch (error) {
      const migrationError = error instanceof MigrationError
        ? error
        : new MigrationError("SCAN_FAILED", error instanceof Error ? error.message : String(error), error)
      packages.push({ sourcePath, error: { code: migrationError.code, message: migrationError.message } })
    }
  }

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    targetDifyVersion: TARGET_DIFY_VERSION,
    createdAt: new Date().toISOString(),
    inputs: normalizedInputs,
    packages,
    summary: summarize(packages, firstByHash.size),
  }
}

export async function discoverPackagePaths(inputs: readonly string[]): Promise<string[]> {
  const found = new Set<string>()
  for (const input of inputs) await discover(resolve(input), found)
  return [...found].sort()
}

async function discover(path: string, found: Set<string>): Promise<void> {
  const pathStat = await stat(path).catch((error: unknown) => {
    throw new MigrationError("INPUT_NOT_FOUND", `Input does not exist: ${path}`, error)
  })
  if (pathStat.isSymbolicLink()) return
  if (pathStat.isFile()) {
    if (extname(path).toLowerCase() === ".difypkg") found.add(path)
    return
  }
  if (!pathStat.isDirectory()) return
  const children = await readdir(path, { withFileTypes: true })
  for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
    if (child.isSymbolicLink()) continue
    await discover(resolve(path, child.name), found)
  }
}

function summarize(records: readonly BatchPackageRecord[], unique: number): BatchMigrationReport["summary"] {
  const dispositions: Partial<Record<MigrationDisposition, number>> = {}
  for (const record of records) {
    if (!record.plan || record.duplicateOf) continue
    dispositions[record.plan.disposition] = (dispositions[record.plan.disposition] ?? 0) + 1
  }
  const parsed = records.filter((record) => record.manifest).length
  return {
    discovered: records.length,
    parsed,
    failed: records.length - parsed,
    unique,
    duplicates: records.filter((record) => record.duplicateOf).length,
    dispositions,
  }
}

