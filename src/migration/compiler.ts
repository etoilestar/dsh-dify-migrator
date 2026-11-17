import { chmod, mkdir, rm, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import {
  DSH_TOOL_PACKAGE_SCHEMA_VERSION,
  TARGET_DIFY_VERSION,
  type CompiledDshToolPackage,
  type DifyToolParameterIR,
  type DshToolPackageManifest,
} from "../domain.js"
import { readDifyPackage } from "../dify/package-reader.js"
import { extractDifyPackage } from "../dify/package-extractor.js"
import { parseDifyManifest } from "../dify/manifest.js"
import { parseToolProviders } from "../dify/tool-provider.js"
import { dshPackageId, dshToolRef } from "../dsh/identity.js"
import { MigrationError } from "../errors.js"
import { classifyMigration } from "./classifier.js"
import { PYTHON_DIFY_TOOL_WORKER } from "../runtime/python-worker.js"

export interface CompileOptions {
  outputDirectory: string
  pythonCommand?: string
  timeoutMs?: number
}

export async function compileDifyToolPackage(
  sourcePath: string,
  options: CompileOptions,
): Promise<CompiledDshToolPackage> {
  const pkg = await readDifyPackage(sourcePath)
  const difyManifest = parseDifyManifest(pkg)
  const plan = classifyMigration(difyManifest)
  if (plan.disposition !== "wrapped-native") {
    throw new MigrationError("PACKAGE_NOT_COMPILABLE", `Package cannot be compiled as a DSH Tool package: ${plan.disposition}`)
  }
  const providers = parseToolProviders(pkg, difyManifest)
  const missingImplementations = providers.flatMap((provider) => provider.tools
    .filter((tool) => !tool.implementationPath)
    .map((tool) => `${provider.name}/${tool.name}`))
  if (missingImplementations.length > 0) {
    throw new MigrationError("TOOL_IMPLEMENTATION_MISSING", `Tool implementation path missing: ${missingImplementations.join(", ")}`)
  }

  const outputDirectory = resolve(options.outputDirectory)
  const payloadDirectory = join(outputDirectory, "payload")
  const runtimeDirectory = join(outputDirectory, "runtime")
  await rm(outputDirectory, { recursive: true, force: true })
  await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 })
  try {
    await extractDifyPackage(sourcePath, payloadDirectory)
    const manifest: DshToolPackageManifest = {
      schemaVersion: DSH_TOOL_PACKAGE_SCHEMA_VERSION,
      id: dshPackageId(difyManifest.author, difyManifest.name),
      name: difyManifest.name,
      version: difyManifest.version,
      description: `DSH-native Tool package migrated from ${difyManifest.packageId}`,
      origin: {
        platform: "dify",
        targetVersion: TARGET_DIFY_VERSION,
        packageId: difyManifest.packageId,
        sha256: pkg.sha256,
        author: difyManifest.author,
        plugin: difyManifest.name,
      },
      runtime: {
        kind: "python-dify-tool-worker",
        command: options.pythonCommand ?? "python3",
        workerPath: "runtime/dify_tool_worker.py",
        payloadPath: "payload",
        timeoutMs: options.timeoutMs ?? 30_000,
      },
      credentials: uniqueCredentials(providers.flatMap((provider) => provider.credentials)),
      tools: providers.flatMap((provider) => provider.tools.map((tool) => ({
        ref: dshToolRef(difyManifest.author, difyManifest.name, tool.name),
        name: tool.name,
        label: tool.label,
        description: tool.description,
        provider: provider.name,
        implementationPath: tool.implementationPath as string,
        inputSchema: parameterSchema(tool.parameters),
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
      }))),
    }
    const workerPath = join(runtimeDirectory, "dify_tool_worker.py")
    const manifestPath = join(outputDirectory, "dsh-tool-package.json")
    await writeFile(workerPath, PYTHON_DIFY_TOOL_WORKER, { encoding: "utf8", mode: 0o700 })
    await chmod(workerPath, 0o700)
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    await writeFile(join(outputDirectory, "MIGRATED_FROM_DIFY.md"), provenance(sourcePath, manifest), { encoding: "utf8", mode: 0o600 })
    return { outputDirectory, manifestPath, manifest }
  } catch (error) {
    await rm(outputDirectory, { recursive: true, force: true })
    throw error
  }
}

function parameterSchema(parameters: readonly DifyToolParameterIR[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(parameters.map((parameter) => [parameter.name, {
      ...parameterType(parameter),
      description: parameter.description,
      ...(parameter.defaultValue !== undefined ? { default: parameter.defaultValue } : {}),
    }])),
    required: parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name),
  }
}

function parameterType(parameter: DifyToolParameterIR): Record<string, unknown> {
  if (parameter.options && parameter.options.length > 0) return { type: "string", enum: parameter.options.map((option) => option.value) }
  switch (parameter.type) {
    case "number": return { type: "number" }
    case "boolean": return { type: "boolean" }
    case "array":
    case "files": return { type: "array" }
    case "object": return { type: "object" }
    default: return { type: "string" }
  }
}

function uniqueCredentials(credentials: Array<{ name: string; label: string; required: boolean; secret: boolean }>): Array<{ name: string; label: string; required: boolean; secret: boolean }> {
  return [...new Map(credentials.map((credential) => [credential.name, credential])).values()]
    .sort((left, right) => left.name.localeCompare(right.name))
}

function provenance(sourcePath: string, manifest: DshToolPackageManifest): string {
  return `# Migrated from Dify\n\n- Source: \`${basename(sourcePath)}\`\n- Source SHA-256: \`${manifest.origin.sha256}\`\n- Dify package: \`${manifest.origin.packageId}\`\n- DSH package: \`${manifest.id}@${manifest.version}\`\n\nCredentials are deliberately not copied. Rebind them in DSH.\n`
}
