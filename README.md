# DSH Dify Migrator

`dsh-dify-migrator` is a compiler and migration tool for moving Dify plugin
packages and workflow dependencies into the DSH plugin ecosystem. The target
is one user-visible runtime contract: migrated capabilities register as native
DSH tools or providers rather than remaining in a second Dify registry.

The current milestone targets Dify `1.13.3` Tool plugins plus the Xinference
Model Provider's LLM, embedding, rerank and speech capabilities and provides:

- safe, bounded inspection of one or many `.difypkg` files;
- normalized plugin manifests and capability inventory;
- deterministic package identities and SHA-256 provenance;
- compatibility classification for the native Tool and Xinference model scope;
- batch deduplication and machine-readable migration reports;
- compilation into native DSH Tool or Model package contracts;
- optional atomic installation into a DSH data directory;
- a private Python compatibility worker behind the DSH registry and runtime.

Xinference text chat, SSE streaming, usage, OpenAI-compatible tool calls,
embeddings, reranking, speech-to-text and text-to-speech are compiled into one
metadata-only native model package. Other model providers, vision inputs and
lifecycle extensions remain review-required or unsupported.

## Usage

```bash
npm install
npm run build
npm link
node dist/cli.js scan ./plugins --output migration-report.json
node dist/cli.js convert ./plugins --output ./converted
node dist/cli.js convert ./plugins --output ./converted --install /path/to/dsh/data
node dist/cli.js convert ./dify-tool-packages.zip --output ./converted --install /path/to/dsh/data --report conversion-report.json
```

`npm link` installs the `dsh-dify-migrator` executable for the DSH Host. In a
managed deployment, install this package in the Host image instead and set the
DSH `difyMigratorCommand` configuration to that executable's absolute path.

Inputs may be individual `.difypkg` files, directories, or a batch `.zip`
containing multiple `.difypkg` files. Batch archives are expanded through the
same bounded path, symlink, entry-count, expanded-size and compression-ratio
checks as individual packages. Compatible Tool and Xinference Model packages
are installed while unsupported capability kinds and per-package failures
remain visible in the machine-readable conversion report.

Then restart/reload `dsh-visual-workflow` and import the Dify workflow YAML. Both
projects derive the same stable identity from `author/plugin/tool`, so a Dify
Tool node is changed directly into `dsh_migrated__author__plugin__tool`; no
per-node rebinding or second user-visible Dify catalog is created.

A Dify Xinference provider such as `langgenius/xinference/xinference` maps to
`dsh_model__langgenius__xinference__xinference`. Agent/LLM nodes retain their
model UID and use that native DSH provider route.

For packages requiring credentials, configure the DSH Host private file rather
than copying Dify secrets:

```json
{
  "dsh_dify__author__plugin": {
    "api_key": "replace-in-the-target-environment"
  }
}
```

Save it as `<dsh-data-directory>/migrated-tool-credentials.json`, restrict its
filesystem permissions, and reload the Host. The workflow and exported package
never contain this value.

Xinference credentials use the same package-id key in the separate Host-private
`<dsh-data-directory>/migrated-model-credentials.json` file:

```json
{
  "dsh_dify__langgenius__xinference": {
    "server_url": "http://127.0.0.1:9997",
    "api_key": "replace-if-required",
    "invoke_timeout": "60",
    "models": {
      "llm": { "model_uid": "qwen-chat" },
      "text-embedding": { "model_uid": "bge-m3" },
      "rerank": { "model_uid": "bge-reranker-v2-m3" },
      "speech2text": { "model_uid": "whisper-large-v3" },
      "tts": { "model_uid": "CosyVoice-300M" }
    }
  }
}
```

The URL must be the Xinference server root. Each model type uses its own
deployed `model_uid`; root-level URL, API key and timeout values are shared.
The previous root-level `model_uid` remains a backward-compatible LLM setting.
Reload the Host after changing the file.

The scanner never extracts package contents to the current directory. It
rejects path traversal, symbolic links, excessive entry counts, oversized
entries, excessive aggregate size, and suspicious compression ratios.

## Migration dispositions

- `wrapped-native`: can be exposed through a generated native DSH plugin, with
  the original implementation isolated behind the DSH execution contract.
- `wrapped-model`: can be exposed through a generated native DSH model package
  and a reviewed provider adapter (currently Xinference LLM, text-embedding,
  rerank, speech2text and TTS).
- `review-required`: understood, but needs a dedicated target adapter.
- `unsupported`: outside the current target runtime or unsafe to translate.
- `incompatible`: explicitly requires a Dify version newer than the target.

## Scope boundary

Arbitrary Python cannot be soundly translated into TypeScript. The Tool
compiler therefore emits a standard DSH package and owns a private worker as
an implementation detail. DSH remains the only registry, credential surface,
workflow node type, lifecycle owner, and audit boundary. Credentials are not
copied from Dify. The Xinference adapter is metadata-only and does not execute
the package's Python; its reviewed HTTP model routes are enabled. Packages
that require third-party Python dependencies need a
reviewed Python environment; the migrator never downloads dependencies during
conversion.

