import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { basename } from "node:path"
import yauzl, { type Entry, type ZipFile } from "yauzl"
import type { PackageEntryIR, RawDifyPackage } from "../domain.js"
import { MigrationError } from "../errors.js"

export interface PackageReadLimits {
  maxPackageBytes: number
  maxEntries: number
  maxEntryBytes: number
  maxTotalUncompressedBytes: number
  maxTextFileBytes: number
  maxCompressionRatio: number
}

export const DEFAULT_PACKAGE_LIMITS: PackageReadLimits = {
  maxPackageBytes: 512 * 1024 * 1024,
  maxEntries: 4096,
  maxEntryBytes: 128 * 1024 * 1024,
  maxTotalUncompressedBytes: 512 * 1024 * 1024,
  maxTextFileBytes: 2 * 1024 * 1024,
  maxCompressionRatio: 250,
}

export async function readDifyPackage(
  sourcePath: string,
  limits: PackageReadLimits = DEFAULT_PACKAGE_LIMITS,
): Promise<RawDifyPackage> {
  const fileStat = await stat(sourcePath).catch((error: unknown) => {
    throw new MigrationError("PACKAGE_NOT_FOUND", `Cannot read package: ${sourcePath}`, error)
  })
  if (!fileStat.isFile()) throw new MigrationError("PACKAGE_NOT_FILE", `Package path is not a file: ${sourcePath}`)
  if (fileStat.size > limits.maxPackageBytes) {
    throw new MigrationError("PACKAGE_TOO_LARGE", `${basename(sourcePath)} exceeds the package size limit`)
  }

  const sha256Promise = hashFile(sourcePath)
  const inspected = await inspectZip(sourcePath, limits)
  return {
    sourcePath,
    sha256: await sha256Promise,
    byteLength: fileStat.size,
    signatureEnvelope: inspected.signatureEnvelope,
    entries: inspected.entries,
    textFiles: inspected.textFiles,
  }
}

export function validatePackageEntryPath(entryPath: string): string {
  if (!entryPath || entryPath.includes("\0")) {
    throw new MigrationError("UNSAFE_ENTRY_PATH", "Package contains an empty or NUL entry path")
  }
  const normalized = entryPath.replaceAll("\\", "/")
  if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) {
    throw new MigrationError("UNSAFE_ENTRY_PATH", `Package entry is absolute: ${entryPath}`)
  }
  const segments = normalized.split("/")
  if (segments.some((segment) => segment === "..")) {
    throw new MigrationError("UNSAFE_ENTRY_PATH", `Package entry escapes its root: ${entryPath}`)
  }
  return normalized.replace(/^\.\//, "")
}

function inspectZip(
  sourcePath: string,
  limits: PackageReadLimits,
): Promise<{ entries: PackageEntryIR[]; textFiles: ReadonlyMap<string, string>; signatureEnvelope?: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    yauzl.open(sourcePath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(new MigrationError("INVALID_DIFYPKG", `Cannot open ${basename(sourcePath)} as a ZIP package`, openError))
        return
      }
      consumeZip(zipFile, limits).then(resolve, reject)
    })
  })
}

async function consumeZip(
  zipFile: ZipFile,
  limits: PackageReadLimits,
): Promise<{ entries: PackageEntryIR[]; textFiles: ReadonlyMap<string, string>; signatureEnvelope?: Record<string, unknown> }> {
  const entries: PackageEntryIR[] = []
  const textFiles = new Map<string, string>()
  let totalUncompressedBytes = 0

  return await new Promise((resolve, reject) => {
    let settled = false
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      zipFile.close()
      reject(error instanceof MigrationError ? error : new MigrationError("INVALID_DIFYPKG", "Failed while reading package", error))
    }
    zipFile.on("error", fail)
    zipFile.on("end", () => {
      if (settled) return
      settled = true
      resolve({ entries, textFiles, signatureEnvelope: parseSignatureEnvelope(zipFile.comment) })
    })
    zipFile.on("entry", (entry: Entry) => {
      void handleEntry(zipFile, entry, entries, textFiles, limits, () => totalUncompressedBytes, (value) => {
        totalUncompressedBytes = value
      }).then(() => zipFile.readEntry(), fail)
    })
    zipFile.readEntry()
  })
}

async function handleEntry(
  zipFile: ZipFile,
  entry: Entry,
  entries: PackageEntryIR[],
  textFiles: Map<string, string>,
  limits: PackageReadLimits,
  getTotal: () => number,
  setTotal: (value: number) => void,
): Promise<void> {
  const entryPath = validatePackageEntryPath(entry.fileName)
  if (entries.length >= limits.maxEntries) throw new MigrationError("TOO_MANY_ENTRIES", "Package entry count exceeds the limit")
  if (isSymlink(entry)) throw new MigrationError("UNSAFE_SYMLINK", `Symbolic links are not allowed: ${entryPath}`)
  if (entry.uncompressedSize > limits.maxEntryBytes) {
    throw new MigrationError("ENTRY_TOO_LARGE", `Package entry exceeds the size limit: ${entryPath}`)
  }
  const total = getTotal() + entry.uncompressedSize
  if (total > limits.maxTotalUncompressedBytes) {
    throw new MigrationError("PACKAGE_EXPANDS_TOO_LARGE", "Package aggregate uncompressed size exceeds the limit")
  }
  setTotal(total)
  if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio) {
    throw new MigrationError("SUSPICIOUS_COMPRESSION", `Suspicious compression ratio for: ${entryPath}`)
  }
  entries.push({ path: entryPath, compressedBytes: entry.compressedSize, uncompressedBytes: entry.uncompressedSize })
  if (entryPath.endsWith("/")) return
  if (!shouldReadText(entryPath) || entry.uncompressedSize > limits.maxTextFileBytes) return
  const content = await readEntry(zipFile, entry)
  textFiles.set(entryPath, content.toString("utf8"))
}

function shouldReadText(entryPath: string): boolean {
  if (["manifest.yaml", "manifest.yml", "requirements.txt", "pyproject.toml"].includes(entryPath)) return true
  return /^(provider|tools?|models?|datasources?|triggers?|endpoints?|agent_strategies?)\/.+\.(ya?ml|json)$/i.test(entryPath)
}

function readEntry(zipFile: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(new MigrationError("ENTRY_READ_FAILED", `Cannot read package entry: ${entry.fileName}`, error))
        return
      }
      const chunks: Buffer[] = []
      stream.on("data", (chunk: Buffer) => chunks.push(chunk))
      stream.on("error", reject)
      stream.on("end", () => resolve(Buffer.concat(chunks)))
    })
  })
}

function isSymlink(entry: Entry): boolean {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  return (unixMode & 0xf000) === 0xa000
}

function parseSignatureEnvelope(comment: string | Buffer | undefined): Record<string, unknown> | undefined {
  if (!comment) return undefined
  const text = Buffer.isBuffer(comment) ? comment.toString("utf8") : comment
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

async function hashFile(sourcePath: string): Promise<string> {
  const hash = createHash("sha256")
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(sourcePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", resolve)
  })
  return hash.digest("hex")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

