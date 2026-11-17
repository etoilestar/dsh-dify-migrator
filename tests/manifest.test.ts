import { describe, expect, it } from "vitest"
import type { RawDifyPackage } from "../src/domain.js"
import { parseDifyManifest } from "../src/dify/manifest.js"
import { classifyMigration } from "../src/migration/classifier.js"

function packageWithManifest(manifest: string): RawDifyPackage {
  return {
    sourcePath: "/fixture/plugin.difypkg",
    sha256: "a".repeat(64),
    byteLength: 100,
    entries: [],
    textFiles: new Map([["manifest.yaml", manifest]]),
  }
}

describe("Dify manifest", () => {
  it("normalizes a Python Tool plugin and sends it to the native wrapper path", () => {
    const manifest = parseDifyManifest(packageWithManifest(`
author: example
name: query_tool
version: 0.0.1
type: plugin
meta:
  version: 0.0.1
  runner:
    language: python
    version: "3.12"
    entrypoint: main
plugins:
  tools:
    - provider/query.yaml
resource:
  permission:
    tool:
      enabled: true
`))
    expect(manifest.capabilities).toEqual(["tool"])
    expect(manifest.permissions).toEqual(["tool.enabled"])
    expect(classifyMigration(manifest).disposition).toBe("wrapped-native")
  })

  it("classifies model providers separately from Tool migration", () => {
    const manifest = parseDifyManifest(packageWithManifest(`
author: langgenius
name: xinference
version: 0.0.17
type: plugin
meta:
  version: 0.0.1
  runner:
    language: python
plugins:
  models:
    - provider/xinference.yaml
resource: {}
`))
    expect(classifyMigration(manifest).disposition).toBe("review-required")
    expect(classifyMigration(manifest).issues[0]?.code).toBe("MODEL_ADAPTER_REQUIRED")
  })

  it("rejects plugins that explicitly require a newer Dify version", () => {
    const manifest = parseDifyManifest(packageWithManifest(`
author: example
name: future
version: 1.0.0
type: plugin
meta:
  minimum_dify_version: 1.16.0
plugins:
  tools: [tools/future.yaml]
resource: {}
`))
    expect(classifyMigration(manifest).disposition).toBe("incompatible")
  })
})

