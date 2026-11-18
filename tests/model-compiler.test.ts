import { createWriteStream } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import yazl from "yazl"
import { readDifyPackage } from "../src/dify/package-reader.js"
import { parseDifyManifest } from "../src/dify/manifest.js"
import { parseModelProviders } from "../src/dify/model-provider.js"
import { classifyMigration } from "../src/migration/classifier.js"
import { compileDifyModelPackage } from "../src/migration/model-compiler.js"
import { installDshModelPackage } from "../src/migration/installer.js"

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("DSH Model package compiler", () => {
  it("compiles and installs a Xinference model provider without copying credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-dify-model-"))
    temporaryDirectories.push(root)
    const source = join(root, "xinference.difypkg")
    await writeXinferencePackage(source)

    const pkg = await readDifyPackage(source)
    const manifest = parseDifyManifest(pkg)
    const providers = parseModelProviders(pkg, manifest)
    expect(classifyMigration(manifest, undefined, providers)).toMatchObject({ disposition: "wrapped-model" })

    const compiled = await compileDifyModelPackage(source, { outputDirectory: join(root, "compiled") })
    expect(compiled.manifest).toMatchObject({
      id: "dsh_dify__langgenius__xinference",
      version: "0.0.17",
      providers: [{
        ref: "dsh_model__langgenius__xinference__xinference",
        adapter: "xinference-openai-compatible",
        supportedModelTypes: ["llm", "text-embedding", "rerank", "speech2text", "tts"],
      }],
    })
    const serialized = await readFile(compiled.manifestPath, "utf8")
    expect(serialized).not.toContain("secret-value")
    expect(JSON.parse(serialized)).toEqual(compiled.manifest)

    const installed = await installDshModelPackage(compiled.outputDirectory, join(root, "dsh-data"))
    expect(installed.replaceAll("\\", "/")).toContain("migrated-models/dsh_dify__langgenius__xinference@0.0.17")
  })
})

function writeXinferencePackage(target: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const zip = new yazl.ZipFile()
    zip.addBuffer(Buffer.from(`
author: langgenius
name: xinference
version: 0.0.17
type: plugin
meta:
  runner:
    language: python
plugins:
  models: [provider/xinference.yaml]
resource: {}
`), "manifest.yaml")
    zip.addBuffer(Buffer.from(`
provider: xinference
label: { en_US: Xorbits Inference }
supported_model_types: [llm, text-embedding, rerank, speech2text, tts]
model_credential_schema:
  credential_form_schemas:
    - variable: server_url
      type: text-input
      required: true
      label: { en_US: Server URL }
    - variable: model_uid
      type: text-input
      required: true
      label: { en_US: Model UID }
    - variable: api_key
      type: secret-input
      required: false
      label: { en_US: API key }
`), "provider/xinference.yaml")
    const output = createWriteStream(target)
    output.on("close", resolvePromise)
    output.on("error", reject)
    zip.outputStream.on("error", reject)
    zip.outputStream.pipe(output)
    zip.end()
  })
}
