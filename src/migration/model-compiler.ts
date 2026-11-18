import { mkdir, rm, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import {
  DSH_MODEL_PACKAGE_SCHEMA_VERSION,
  isSupportedXinferenceModelType,
  TARGET_DIFY_VERSION,
  type CompiledDshModelPackage,
  type DshModelPackageManifest,
} from "../domain.js"
import { parseDifyManifest } from "../dify/manifest.js"
import { parseModelProviders } from "../dify/model-provider.js"
import { readDifyPackage } from "../dify/package-reader.js"
import { dshModelProviderRef, dshPackageId } from "../dsh/identity.js"
import { MigrationError } from "../errors.js"
import { classifyMigration } from "./classifier.js"

export interface CompileModelOptions {
  outputDirectory: string
  timeoutMs?: number
}

export async function compileDifyModelPackage(
  sourcePath: string,
  options: CompileModelOptions,
): Promise<CompiledDshModelPackage> {
  const pkg = await readDifyPackage(sourcePath)
  const difyManifest = parseDifyManifest(pkg)
  const providers = parseModelProviders(pkg, difyManifest)
  const plan = classifyMigration(difyManifest, TARGET_DIFY_VERSION, providers)
  if (plan.disposition !== "wrapped-model") {
    throw new MigrationError("PACKAGE_NOT_COMPILABLE", `Package cannot be compiled as a DSH Model package: ${plan.disposition}`)
  }
  const unsupported = providers.filter((provider) => provider.adapter === "unsupported")
  if (unsupported.length > 0) {
    throw new MigrationError("MODEL_ADAPTER_UNSUPPORTED", `No DSH model adapter for: ${unsupported.map((provider) => provider.name).join(", ")}`)
  }

  const outputDirectory = resolve(options.outputDirectory)
  await rm(outputDirectory, { recursive: true, force: true })
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 })
  try {
    const manifest: DshModelPackageManifest = {
      schemaVersion: DSH_MODEL_PACKAGE_SCHEMA_VERSION,
      id: dshPackageId(difyManifest.author, difyManifest.name),
      name: difyManifest.name,
      version: difyManifest.version,
      description: `DSH-native Model package migrated from ${difyManifest.packageId}`,
      origin: {
        platform: "dify",
        targetVersion: TARGET_DIFY_VERSION,
        packageId: difyManifest.packageId,
        sha256: pkg.sha256,
        author: difyManifest.author,
        plugin: difyManifest.name,
      },
      runtime: {
        kind: "openai-compatible-model-adapter",
        timeoutMs: options.timeoutMs ?? 120_000,
      },
      providers: providers.map((provider) => ({
        ref: dshModelProviderRef(difyManifest.author, difyManifest.name, provider.name),
        name: provider.name,
        label: provider.label,
        description: `${provider.label} migrated from Dify`,
        adapter: "xinference-openai-compatible",
        supportedModelTypes: provider.supportedModelTypes.filter(isSupportedXinferenceModelType),
        credentials: provider.credentials,
      })),
    }
    const manifestPath = join(outputDirectory, "dsh-model-package.json")
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    await writeFile(join(outputDirectory, "MIGRATED_FROM_DIFY.md"), provenance(sourcePath, manifest), { encoding: "utf8", mode: 0o600 })
    return { outputDirectory, manifestPath, manifest }
  } catch (error) {
    await rm(outputDirectory, { recursive: true, force: true })
    throw error
  }
}

function provenance(sourcePath: string, manifest: DshModelPackageManifest): string {
  return `# Migrated from Dify\n\n- Source: \`${basename(sourcePath)}\`\n- Source SHA-256: \`${manifest.origin.sha256}\`\n- Dify package: \`${manifest.origin.packageId}\`\n- DSH package: \`${manifest.id}@${manifest.version}\`\n\nServer URL, model UID and API keys are deliberately not copied. Rebind them in DSH.\n`
}
