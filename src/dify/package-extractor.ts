import { createWriteStream } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { dirname, resolve, sep } from "node:path"
import yauzl, { type Entry, type ZipFile } from "yauzl"
import { DEFAULT_PACKAGE_LIMITS, type PackageReadLimits, validatePackageEntryPath } from "./package-reader.js"
import { MigrationError } from "../errors.js"

export async function extractDifyPackage(
  sourcePath: string,
  destination: string,
  limits: PackageReadLimits = DEFAULT_PACKAGE_LIMITS,
): Promise<void> {
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true, mode: 0o700 })
  try {
    const zipFile = await openZip(sourcePath)
    await extractEntries(zipFile, destination, limits)
  } catch (error) {
    await rm(destination, { recursive: true, force: true })
    throw error
  }
}

function openZip(sourcePath: string): Promise<ZipFile> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(sourcePath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(new MigrationError("INVALID_DIFYPKG", "Cannot open package for extraction", error))
        return
      }
      resolvePromise(zipFile)
    })
  })
}

function extractEntries(zipFile: ZipFile, destination: string, limits: PackageReadLimits): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let entries = 0
    let totalBytes = 0
    let settled = false
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      zipFile.close()
      reject(error)
    }
    zipFile.on("error", fail)
    zipFile.on("end", () => {
      if (settled) return
      settled = true
      resolvePromise()
    })
    zipFile.on("entry", (entry: Entry) => {
      void extractEntry(zipFile, entry, destination, limits, () => {
        entries += 1
        totalBytes += entry.uncompressedSize
        if (entries > limits.maxEntries) throw new MigrationError("TOO_MANY_ENTRIES", "Package entry count exceeds the limit")
        if (totalBytes > limits.maxTotalUncompressedBytes) {
          throw new MigrationError("PACKAGE_EXPANDS_TOO_LARGE", "Package aggregate uncompressed size exceeds the limit")
        }
      }).then(() => zipFile.readEntry(), fail)
    })
    zipFile.readEntry()
  })
}

async function extractEntry(
  zipFile: ZipFile,
  entry: Entry,
  destination: string,
  limits: PackageReadLimits,
  account: () => void,
): Promise<void> {
  const path = validatePackageEntryPath(entry.fileName)
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  if ((unixMode & 0xf000) === 0xa000) throw new MigrationError("UNSAFE_SYMLINK", `Symbolic links are not allowed: ${path}`)
  if (entry.uncompressedSize > limits.maxEntryBytes) throw new MigrationError("ENTRY_TOO_LARGE", `Package entry exceeds the size limit: ${path}`)
  if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > limits.maxCompressionRatio) {
    throw new MigrationError("SUSPICIOUS_COMPRESSION", `Suspicious compression ratio for: ${path}`)
  }
  account()
  const target = resolve(destination, path)
  const root = resolve(destination) + sep
  if (!target.startsWith(root)) throw new MigrationError("UNSAFE_ENTRY_PATH", `Package entry escapes extraction root: ${path}`)
  if (path.endsWith("/")) {
    await mkdir(target, { recursive: true, mode: 0o700 })
    return
  }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await pipeEntry(zipFile, entry, target)
}

function pipeEntry(zipFile: ZipFile, entry: Entry, target: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(new MigrationError("ENTRY_READ_FAILED", `Cannot read package entry: ${entry.fileName}`, error))
        return
      }
      const output = createWriteStream(target, { mode: 0o600 })
      stream.on("error", reject)
      output.on("error", reject)
      output.on("close", resolvePromise)
      stream.pipe(output)
    })
  })
}
