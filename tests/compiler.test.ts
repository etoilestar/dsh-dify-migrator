import { spawn } from "node:child_process"
import { createWriteStream, existsSync } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import yazl from "yazl"
import { compileDifyToolPackage } from "../src/migration/compiler.js"
import { installDshToolPackage } from "../src/migration/installer.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("DSH Tool package compiler", () => {
  it("compiles, installs and executes a simple Dify Tool as one DSH package", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-dify-compile-"))
    temporaryDirectories.push(root)
    const source = join(root, "echo.difypkg")
    await writeToolPackage(source)
    const localPython = `${process.env.HOME}/.local/bin/python3.11`
    const pythonCommand = process.env.DSH_TEST_PYTHON ?? (existsSync(localPython) ? localPython : "python3")
    const compiled = await compileDifyToolPackage(source, { outputDirectory: join(root, "compiled"), pythonCommand })

    expect(compiled.manifest).toMatchObject({
      id: "dsh_dify__example__echo",
      version: "0.0.1",
      origin: { platform: "dify", author: "example", plugin: "echo" },
      tools: [{ ref: "dsh_migrated__example__echo__echo", implementationPath: "tools/echo.py" }],
    })
    expect(JSON.parse(await readFile(compiled.manifestPath, "utf8"))).toEqual(compiled.manifest)
    const installed = await installDshToolPackage(compiled.outputDirectory, join(root, "dsh-data"))
    expect(installed).toContain("migrated-tools/dsh_dify__example__echo@0.0.1")

    const request = JSON.stringify({
      payloadPath: join(compiled.outputDirectory, "payload"),
      implementationPath: "tools/echo.py",
      arguments: { query: "hello" },
      credentials: {},
    })
    const stdout = await runWorker(pythonCommand, join(compiled.outputDirectory, "runtime", "dify_tool_worker.py"), request)
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, messages: [{ type: "text", value: "echo:hello" }] })
  })
})

function writeToolPackage(target: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const zip = new yazl.ZipFile()
    zip.addBuffer(Buffer.from(`
author: example
name: echo
version: 0.0.1
type: plugin
meta:
  runner:
    language: python
plugins:
  tools: [provider/echo.yaml]
resource: {}
`), "manifest.yaml")
    zip.addBuffer(Buffer.from(`
identity:
  name: echo
  label: { en_US: Echo }
tools: [tools/echo.yaml]
extra:
  python: { source: provider/echo.py }
`), "provider/echo.yaml")
    zip.addBuffer(Buffer.from(`
identity:
  name: echo
  label: { en_US: Echo }
description: { llm: Echo a value. }
parameters:
  - name: query
    type: string
    required: true
    form: llm
    llm_description: Input value.
extra:
  python: { source: tools/echo.py }
`), "tools/echo.yaml")
    zip.addBuffer(Buffer.from(`
from collections.abc import Generator
from dify_plugin import Tool
from dify_plugin.entities.tool import ToolInvokeMessage

class EchoTool(Tool):
    def _invoke(self, tool_parameters: dict) -> Generator[ToolInvokeMessage, None, None]:
        yield self.create_text_message("echo:" + str(tool_parameters.get("query", "")))
`), "tools/echo.py")
    const output = createWriteStream(target)
    output.on("close", resolvePromise)
    output.on("error", reject)
    zip.outputStream.on("error", reject)
    zip.outputStream.pipe(output)
    zip.end()
  })
}

function runWorker(command: string, workerPath: string, request: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [workerPath], { stdio: ["pipe", "pipe", "pipe"] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
    child.on("error", reject)
    child.on("close", (code) => code === 0
      ? resolvePromise(Buffer.concat(stdout).toString("utf8"))
      : reject(new Error(Buffer.concat(stderr).toString("utf8") || `worker exited ${code}`)))
    child.stdin.end(request)
  })
}
