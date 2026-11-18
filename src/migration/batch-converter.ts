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
import { parseModelProviders } from "../dify/model-provider.js"
import { dshPackageId } from "../dsh/identity.js"
import { MigrationError } from "../errors.js"
import { classifyMigration } from "./classifier.js"
import { compileDifyToolPackage } from "./compiler.js"
import { compileDifyModelPackage } from "./model-compiler.js"
import { installDshModelPackage, installDshToolPackage } from "./installer.js"

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
      const modelProviders = manifest.capabilities.includes("model") ? parseModelProviders(pkg, manifest) : undefined
      const plan = classifyMigration(manifest, TARGET_DIFY_VERSION, modelProviders)
      if (plan.disposition !== "wrapped-native" && plan.disposition !== "wrapped-model") {
        records.push({
          sourcePath,
          status: "skipped",
          sha256: pkg.sha256,
          packageId: manifest.packageId,
          disposition: plan.disposition,
          issues: plan.issues,
        })
        continue
      }
      const directory = join(outputRoot, `${dshPackageId(manifest.author, manifest.name)}@${manifest.version}`)
      const compiled = plan.disposition === "wrapped-native"
        ? await compileDifyToolPackage(sourcePath, {
            outputDirectory: directory,
            ...(options.pythonCommand ? { pythonCommand: options.pythonCommand } : {}),
            ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
          })
        : await compileDifyModelPackage(sourcePath, {
            outputDirectory: directory,
            ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
          })
      const installedDirectory = options.installDirectory
        ? plan.disposition === "wrapped-native"
          ? await installDshToolPackage(compiled.outputDirectory, resolve(options.installDirectory))
          : await installDshModelPackage(compiled.outputDirectory, resolve(options.installDirectory))
        : undefined
      const tools = "tools" in compiled.manifest ? compiled.manifest.tools.map((tool) => tool.ref) : undefined
      const providers = "providers" in compiled.manifest ? compiled.manifest.providers.map((provider) => provider.ref) : undefined
      const credentials = "credentials" in compiled.manifest
        ? compiled.manifest.credentials.map((credential) => credential.name)
        : [...new Set(compiled.manifest.providers.flatMap((provider) => provider.credentials.map((credential) => credential.name)))].sort()
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
        ...(tools ? { tools } : {}),
        ...(providers ? { providers } : {}),
        credentials,
        issues: plan.issues,
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
