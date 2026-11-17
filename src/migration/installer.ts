import { cp, mkdir, readFile, rename, rm, stat } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { DSH_TOOL_PACKAGE_SCHEMA_VERSION, type DshToolPackageManifest } from "../domain.js"
import { MigrationError } from "../errors.js"

export async function installDshToolPackage(compiledDirectory: string, dshDataDirectory: string): Promise<string> {
  const source = resolve(compiledDirectory)
  const manifest = await readManifest(join(source, "dsh-tool-package.json"))
  const root = resolve(dshDataDirectory, "migrated-tools")
  const target = join(root, `${manifest.id}@${manifest.version}`)
  const staging = join(root, `.install-${basename(target)}-${randomUUID()}`)
  await mkdir(root, { recursive: true, mode: 0o700 })
  await rm(staging, { recursive: true, force: true })
  await cp(source, staging, { recursive: true, errorOnExist: true, force: false })
  const existing = await stat(target).catch(() => undefined)
  if (existing) {
    const installed = await readManifest(join(target, "dsh-tool-package.json"))
    if (installed.origin.sha256 === manifest.origin.sha256) {
      await rm(staging, { recursive: true, force: true })
      return target
    }
    await rm(staging, { recursive: true, force: true })
    throw new MigrationError("PACKAGE_VERSION_CONFLICT", `${manifest.id}@${manifest.version} is already installed from a different source package`)
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await rename(staging, target)
  return target
}

async function readManifest(path: string): Promise<DshToolPackageManifest> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, "utf8"))
  } catch (error) {
    throw new MigrationError("DSH_PACKAGE_MANIFEST_INVALID", `Cannot read DSH package manifest: ${path}`, error)
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== DSH_TOOL_PACKAGE_SCHEMA_VERSION || typeof parsed.id !== "string"
    || typeof parsed.version !== "string" || !isRecord(parsed.origin) || typeof parsed.origin.sha256 !== "string") {
    throw new MigrationError("DSH_PACKAGE_MANIFEST_INVALID", `Invalid DSH package manifest: ${path}`)
  }
  return parsed as unknown as DshToolPackageManifest
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
