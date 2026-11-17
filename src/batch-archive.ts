import { createWriteStream } from "node:fs"
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, extname, join, resolve, sep } from "node:path"
import yauzl, { type Entry, type ZipFile } from "yauzl"
import { MigrationError } from "./errors.js"
import { validatePackageEntryPath } from "./dify/package-reader.js"

export interface PreparedBatchInputs {
  inputs: string[]
  dispose(): Promise<void>
}

const MAX_BATCH_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_BATCH_ENTRIES = 4096
const MAX_BATCH_ENTRY_BYTES = 512 * 1024 * 1024
const MAX_BATCH_EXPANDED_BYTES = 1024 * 1024 * 1024
const MAX_BATCH_COMPRESSION_RATIO = 250

/** Expands explicitly supplied .zip bundles while leaving files/directories unchanged. */
export async function prepareBatchInputs(inputs: readonly string[]): Promise<PreparedBatchInputs> {
  const root = await mkdtemp(join(tmpdir(), "dsh-dify-upload-"))
  const prepared: string[] = []
  try {
    for (let index = 0; index < inputs.length; index += 1) {
      const input = resolve(inputs[index] as string)
      const inputStat = await stat(input).catch((error: unknown) => {
        throw new MigrationError("INPUT_NOT_FOUND", `Input does not exist: ${input}`, error)
      })
      if (inputStat.isFile() && extname(input).toLowerCase() === ".zip") {
        const destination = join(root, `bundle-${index}`)
        await extractBatchArchive(input, destination)
        prepared.push(destination)
      } else {
        prepared.push(input)
      }
    }
    return {
      inputs: prepared,
      dispose: () => rm(root, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

export async function extractBatchArchive(sourcePath: string, destination: string): Promise<string[]> {
  const sourceStat = await stat(sourcePath)
  if (sourceStat.size > MAX_BATCH_ARCHIVE_BYTES) throw new MigrationError("BATCH_ARCHIVE_TOO_LARGE", `${basename(sourcePath)} exceeds the batch archive size limit`)
  await mkdir(destination, { recursive: true, mode: 0o700 })
  const zipFile = await openZip(sourcePath)
  const extracted = await extractEntries(zipFile, destination)
  if (extracted.length === 0) throw new MigrationError("BATCH_ARCHIVE_EMPTY", `${basename(sourcePath)} contains no .difypkg files`)
  return extracted
}

function openZip(sourcePath: string): Promise<ZipFile> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(sourcePath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(new MigrationError("INVALID_BATCH_ARCHIVE", `Cannot open batch archive: ${basename(sourcePath)}`, error))
        return
      }
      resolvePromise(zipFile)
    })
  })
}

function extractEntries(zipFile: ZipFile, destination: string): Promise<string[]> {
  return new Promise((resolvePromise, reject) => {
    const extracted: string[] = []
    let entryCount = 0
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
      resolvePromise(extracted.sort())
    })
    zipFile.on("entry", (entry: Entry) => {
      void extractEntry(zipFile, entry, destination, entryCount, totalBytes).then((result) => {
        entryCount += 1
        totalBytes += entry.uncompressedSize
        if (result) extracted.push(result)
        zipFile.readEntry()
      }, fail)
    })
    zipFile.readEntry()
  })
}

async function extractEntry(
  zipFile: ZipFile,
  entry: Entry,
  destination: string,
  entryCount: number,
  totalBytes: number,
): Promise<string | undefined> {
  const entryPath = validatePackageEntryPath(entry.fileName)
  if (entryCount >= MAX_BATCH_ENTRIES) throw new MigrationError("BATCH_TOO_MANY_ENTRIES", "Batch archive entry count exceeds the limit")
  if (entry.uncompressedSize > MAX_BATCH_ENTRY_BYTES) throw new MigrationError("BATCH_ENTRY_TOO_LARGE", `Batch entry exceeds the size limit: ${entryPath}`)
  if (totalBytes + entry.uncompressedSize > MAX_BATCH_EXPANDED_BYTES) throw new MigrationError("BATCH_EXPANDS_TOO_LARGE", "Batch archive aggregate uncompressed size exceeds the limit")
  if (entry.compressedSize > 0 && entry.uncompressedSize / entry.compressedSize > MAX_BATCH_COMPRESSION_RATIO) {
    throw new MigrationError("BATCH_SUSPICIOUS_COMPRESSION", `Suspicious compression ratio for: ${entryPath}`)
  }
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  if ((unixMode & 0xf000) === 0xa000) throw new MigrationError("UNSAFE_SYMLINK", `Symbolic links are not allowed: ${entryPath}`)
  if (entryPath.endsWith("/") || extname(entryPath).toLowerCase() !== ".difypkg") return undefined
  const target = resolve(destination, entryPath)
  const root = resolve(destination) + sep
  if (!target.startsWith(root)) throw new MigrationError("UNSAFE_ENTRY_PATH", `Batch entry escapes extraction root: ${entryPath}`)
  await mkdir(dirname(target), { recursive: true, mode: 0o700 })
  await pipeEntry(zipFile, entry, target)
  return target
}

function pipeEntry(zipFile: ZipFile, entry: Entry, target: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(new MigrationError("ENTRY_READ_FAILED", `Cannot read batch entry: ${entry.fileName}`, error))
        return
      }
      const output = createWriteStream(target, { flags: "wx", mode: 0o600 })
      stream.on("error", reject)
      output.on("error", reject)
      output.on("close", resolvePromise)
      stream.pipe(output)
    })
  })
}
