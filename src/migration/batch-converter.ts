import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { discoverPackagePaths } from "../batch.js"
import {
  REPORT_SCHEMA_VERSION,
  TARGET_DIFY_VERSION,
  type BatchConversionRecord,
  type BatchConversionReport,
} from "../domain.js"
import { readDifyPackage } from "../dify/package-reader.js"
import { parseDifyManifest } from "../dify/manifest.js"
import { dshPackageId } from "../dsh/identity.js"
import { MigrationError } from "../errors.js"
import { classifyMigration } from "./classifier.js"
import { compileDifyToolPackage } from "./compiler.js"
import { installDshToolPackage } from "./installer.js"

export interface BatchConvertOptions {
  outputDirectory: string
  installDirectory?: string
  pythonCommand?: string
  timeoutMs?: number
}

export async function convertDifyPackages(inputs: readonly string[], options: BatchConvertOptions): Promise<BatchConversionReport> {
  const normalizedInputs = [...new Set(inputs.map((input) => resolve(input)))].sort()
  const paths = await discoverPackagePaths(normalizedInputs)
  const records: BatchConversionRecord[] = []
  const firstByHash = new Map<string, string>()
  const outputRoot = resolve(options.outputDirectory)
  await mkdir(outputRoot, { recursive: true, mode: 0o700 })

  for (const sourcePath of paths) {
    try {
      const pkg = await readDifyPackage(sourcePath)
      const duplicateOf = firstByHash.get(pkg.sha256)
      if (duplicateOf) {
        records.push({ sourcePath, status: "duplicate", sha256: pkg.sha256, duplicateOf })
        continue
      }
      firstByHash.set(pkg.sha256, sourcePath)
      const manifest = parseDifyManifest(pkg)
      const plan = classifyMigration(manifest)
      if (plan.disposition !== "wrapped-native") {
        records.push({ sourcePath, status: "skipped", sha256: pkg.sha256, packageId: manifest.packageId, disposition: plan.disposition })
        continue
      }
      const directory = join(outputRoot, `${dshPackageId(manifest.author, manifest.name)}@${manifest.version}`)
      const compiled = await compileDifyToolPackage(sourcePath, {
        outputDirectory: directory,
        ...(options.pythonCommand ? { pythonCommand: options.pythonCommand } : {}),
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      })
      const installedDirectory = options.installDirectory
        ? await installDshToolPackage(compiled.outputDirectory, resolve(options.installDirectory))
        : undefined
      records.push({
        sourcePath,
        status: installedDirectory ? "installed" : "converted",
        sha256: pkg.sha256,
        packageId: manifest.packageId,
        disposition: plan.disposition,
        outputDirectory: compiled.outputDirectory,
        ...(installedDirectory ? { installedDirectory } : {}),
        dshPackageId: compiled.manifest.id,
        version: compiled.manifest.version,
        tools: compiled.manifest.tools.map((tool) => tool.ref),
        credentials: compiled.manifest.credentials.map((credential) => credential.name),
      })
    } catch (error) {
      const migrationError = error instanceof MigrationError
        ? error
        : new MigrationError("CONVERSION_FAILED", error instanceof Error ? error.message : String(error), error)
      records.push({ sourcePath, status: "failed", error: { code: migrationError.code, message: migrationError.message } })
    }
  }

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    targetDifyVersion: TARGET_DIFY_VERSION,
    createdAt: new Date().toISOString(),
    inputs: normalizedInputs,
    packages: records,
    summary: {
      discovered: records.length,
      installed: records.filter((record) => record.status === "installed").length,
      converted: records.filter((record) => record.status === "converted").length,
      skipped: records.filter((record) => record.status === "skipped").length,
      duplicates: records.filter((record) => record.status === "duplicate").length,
      failed: records.filter((record) => record.status === "failed").length,
    },
  }
}
