import { describe, expect, it } from "vitest"
import type { DifyManifestIR, RawDifyPackage } from "../src/domain.js"
import { parseToolProviders } from "../src/dify/tool-provider.js"

describe("Tool provider normalization", () => {
  it("normalizes provider credentials, tools, parameters, and implementation paths", () => {
    const pkg: RawDifyPackage = {
      sourcePath: "/fixture/google.difypkg",
      sha256: "b".repeat(64),
      byteLength: 100,
      entries: [],
      textFiles: new Map([
        ["provider/google.yaml", `
identity:
  name: google
  label:
    en_US: Google
credentials_for_provider:
  api_key:
    type: secret-input
    required: true
    label:
      en_US: API key
tools:
  - tools/search.yaml
extra:
  python:
    source: provider/google.py
`],
        ["tools/search.yaml", `
identity:
  name: google_search
  label:
    en_US: Google Search
description:
  llm: Search the web.
parameters:
  - name: query
    type: string
    required: true
    form: llm
    llm_description: Search terms.
  - name: safe
    type: boolean
    required: false
    default: true
    form: form
extra:
  python:
    source: tools/search.py
`],
      ]),
    }
    const manifest: DifyManifestIR = {
      type: "plugin",
      author: "example",
      name: "google",
      version: "0.0.1",
      packageId: `example/google:0.0.1@${pkg.sha256}`,
      runner: { language: "python" },
      capabilityPaths: { tool: ["provider/google.yaml"] },
      capabilities: ["tool"],
      permissions: [],
    }
    const providers = parseToolProviders(pkg, manifest)
    expect(providers).toHaveLength(1)
    expect(providers[0]).toMatchObject({
      name: "google",
      implementationPath: "provider/google.py",
      credentials: [{ name: "api_key", type: "secret-input", required: true, secret: true }],
      tools: [{
        name: "google_search",
        implementationPath: "tools/search.py",
        parameters: [
          { name: "query", type: "string", required: true, form: "llm" },
          { name: "safe", type: "boolean", required: false, defaultValue: true, form: "form" },
        ],
      }],
    })
  })
})
