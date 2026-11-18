# Dify 1.13.3 compatibility audit

Target source tag: `1.13.3`  
Resolved source commit: `59639ca9b2ba2ba4b32b5feff5149cfc1ad0ba74`  
Target workflow DSL version: `0.6.0`  
Bundled plugin daemon image: `langgenius/dify-plugin-daemon:0.5.3-local`

## Package model

A `.difypkg` is a ZIP package containing `manifest.yaml`, provider and
capability declarations, implementation code, dependencies, assets, and an
optional JSON signature envelope in the ZIP comment. The envelope can be
recorded without trusting it. Authenticity verification needs Dify's signing
trust material and is intentionally reported as `not-verified` for now.

Dify 1.13.3 exposes Tool, Model, Extension/Endpoint, Agent Strategy,
Datasource, and Trigger capabilities. These do not all map to the same DSH
runtime contract:

| Dify capability | Initial migration status | Reason |
|---|---|---|
| Tool | wrapper path | Maps to `ctx.tools.register`; implementation isolation remains required |
| Model | Xinference model adapters; otherwise review required | Xinference chat, streaming, usage, tool calls, embeddings, rerank, speech2text and TTS map to reviewed native/Visual capability routes; other providers still need adapters |
| Endpoint/Extension | unsupported in MVP | Requires ingress and lifecycle policy |
| Agent Strategy | unsupported in MVP | It is an agent-loop strategy, not a model-callable Tool |
| Datasource | unsupported in MVP | Needs data ingestion and persistence contracts |
| Trigger | unsupported in MVP | Needs event subscription and workflow-start lifecycle |

## Workflow export boundary

Dify workflow DSL exports dependency identifiers and removes credential
identifiers. It does not embed private plugin packages or usable credentials.
A complete migration therefore needs:

1. one or more workflow DSL files;
2. every referenced `.difypkg` not obtainable from a trusted public source;
3. explicit credential rebinding in DSH.

The compiler must never infer that a dependency declaration is executable
without the matching package.

## Version policy

`meta.minimum_dify_version` is authoritative when present. Packages that
explicitly require a version newer than 1.13.3 are incompatible with this
target profile. SDK dependency version alone is not sufficient to reject a
package because a newer SDK can still use an older feature subset; capability
and declaration inspection is required.

