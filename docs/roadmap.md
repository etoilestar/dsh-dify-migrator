# Roadmap

## M0 — package inventory (implemented)

- recursive batch discovery and SHA-256 deduplication;
- bounded ZIP inspection;
- Dify 1.13.3 manifest normalization;
- Tool provider, credential, parameter, and implementation-source IR;
- deterministic target IDs and migration dispositions;
- JSON report CLI and regression tests.

## M1 — native Tool package compiler

- compile Dify parameter declarations into the supported DSH JSON Schema;
- generate native Cordis plugin source and provenance manifest;
- implement DSH-owned isolated Python worker protocol;
- normalize text, JSON, blob, link, image, and variable outputs;
- credential rebinding, cancellation, timeout, resource, and network policies;
- install/uninstall and workflow dependency rebinding;
- end-to-end validation with the private `qps_test_1s` package when supplied.

## M2 — workflow migration bundle

- accept multiple DSL files and packages in one operation;
- resolve and deduplicate dependency versions;
- produce an atomic install plan and rollback plan;
- rewrite Dify Tool nodes to native DSH tool identities;
- preserve Dify provenance only as metadata.

## M3 — model providers (Xinference implemented)

- Xinference LLM streaming and usage;
- Xinference OpenAI-compatible tool calls;
- Xinference embeddings and reranking;
- Xinference speech2text and TTS;
- native DSH provider registration and workflow identity mapping;
- metadata-only compilation with explicit credential rebinding;
- vision and additional multimodal capability negotiation;
- additional provider adapters and end-to-end service fixtures.

Datasource, Trigger, Agent Strategy, and Endpoint adapters remain out of scope
until DSH has equivalent lifecycle contracts and independent acceptance tests.

