import { createWriteStream } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import yazl from "yazl"
import { prepareBatchInputs } from "../src/batch-archive.js"
import { discoverPackagePaths } from "../src/batch.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("batch archive inputs", () => {
  it("extracts every nested difypkg and ignores unrelated entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-dify-bundle-test-"))
    temporaryDirectories.push(root)
    const archive = join(root, "plugins.zip")
    await writeZip(archive, [
      ["nested/first.difypkg", Buffer.from("first")],
      ["second.difypkg", Buffer.from("second")],
      ["README.txt", Buffer.from("ignored")],
    ])

    const prepared = await prepareBatchInputs([archive])
    try {
      const packages = await discoverPackagePaths(prepared.inputs)
      expect(packages).toHaveLength(2)
      expect(await Promise.all(packages.map((path) => readFile(path, "utf8")))).toEqual(["first", "second"])
    } finally {
      await prepared.dispose()
    }
  })

  it("rejects a batch archive without difypkg entries", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-dify-empty-bundle-test-"))
    temporaryDirectories.push(root)
    const archive = join(root, "plugins.zip")
    await writeZip(archive, [["README.txt", Buffer.from("empty")]])

    await expect(prepareBatchInputs([archive])).rejects.toMatchObject({ code: "BATCH_ARCHIVE_EMPTY" })
  })
})

function writeZip(target: string, entries: Array<[string, Buffer]>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const zip = new yazl.ZipFile()
    for (const [path, value] of entries) zip.addBuffer(value, path)
    const output = createWriteStream(target)
    output.on("close", resolvePromise)
    output.on("error", reject)
    zip.outputStream.on("error", reject)
    zip.outputStream.pipe(output)
    zip.end()
  })
}
