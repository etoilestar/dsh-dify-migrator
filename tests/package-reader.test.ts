import { createWriteStream } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import yazl from "yazl"
import { readDifyPackage, validatePackageEntryPath } from "../src/dify/package-reader.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("safe package reader", () => {
  it("reads required metadata without extracting files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dsh-dify-migrator-"))
    temporaryDirectories.push(directory)
    const packagePath = join(directory, "fixture.difypkg")
    await writeZip(packagePath, {
      "manifest.yaml": "author: example\nname: fixture\nversion: 0.0.1\ntype: plugin\nmeta: {}\nplugins: {}\nresource: {}\n",
      "main.py": "print('not loaded by scanner')\n",
      "provider/tool.yaml": "identity:\n  name: fixture\n",
    })
    const pkg = await readDifyPackage(packagePath)
    expect(pkg.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(pkg.textFiles.has("manifest.yaml")).toBe(true)
    expect(pkg.textFiles.has("provider/tool.yaml")).toBe(true)
    expect(pkg.textFiles.has("main.py")).toBe(false)
  })

  it("rejects traversal and absolute paths", () => {
    expect(() => validatePackageEntryPath("../secret")).toThrow(/escapes/)
    expect(() => validatePackageEntryPath("/etc/passwd")).toThrow(/absolute/)
    expect(() => validatePackageEntryPath("C:\\Windows\\system.ini")).toThrow(/absolute/)
  })
})

function writeZip(target: string, files: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile()
    for (const [name, content] of Object.entries(files)) zip.addBuffer(Buffer.from(content), name)
    const output = createWriteStream(target)
    output.on("close", resolve)
    output.on("error", reject)
    zip.outputStream.on("error", reject)
    zip.outputStream.pipe(output)
    zip.end({ comment: JSON.stringify({ signature: "fixture", time: 1 }), forceZip64Format: false })
  })
}

