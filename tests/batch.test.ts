import { createWriteStream } from "node:fs"
import { copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import yazl from "yazl"
import { scanDifyPackages } from "../src/batch.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("batch scanning", () => {
  it("deduplicates identical packages by SHA-256", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dsh-dify-batch-"))
    temporaryDirectories.push(directory)
    const first = join(directory, "first.difypkg")
    const second = join(directory, "second.difypkg")
    await writeToolPackage(first)
    await copyFile(first, second)
    const report = await scanDifyPackages([directory])
    expect(report.summary).toMatchObject({ discovered: 2, parsed: 2, unique: 1, duplicates: 1 })
    expect(report.summary.dispositions).toEqual({ "wrapped-native": 1 })
    expect(report.packages.filter((record) => record.duplicateOf)).toHaveLength(1)
  })
})

function writeToolPackage(target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile()
    zip.addBuffer(Buffer.from(`
author: example
name: query
version: 0.0.1
type: plugin
meta:
  runner:
    language: python
plugins:
  tools: [provider/query.yaml]
resource: {}
`), "manifest.yaml")
    zip.addBuffer(Buffer.from(`
identity:
  name: query
  label:
    en_US: Query
tools: [tools/query.yaml]
extra:
  python:
    source: provider/query.py
`), "provider/query.yaml")
    zip.addBuffer(Buffer.from(`
identity:
  name: query
  label:
    en_US: Query
description:
  llm: Query a service.
parameters: []
extra:
  python:
    source: tools/query.py
`), "tools/query.yaml")
    const output = createWriteStream(target)
    output.on("close", resolve)
    output.on("error", reject)
    zip.outputStream.on("error", reject)
    zip.outputStream.pipe(output)
    zip.end()
  })
}

