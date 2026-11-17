# DSH Dify Migrator

`dsh-dify-migrator` is a compiler and migration tool for moving Dify plugin
packages and workflow dependencies into the DSH plugin ecosystem. The target
is one user-visible runtime contract: migrated capabilities register as native
DSH tools or providers rather than remaining in a second Dify registry.

The current milestone targets Dify `1.13.3` and provides:

- safe, bounded inspection of one or many `.difypkg` files;
- normalized plugin manifests and capability inventory;
- deterministic package identities and SHA-256 provenance;
- compatibility classification for the initial native Tool migration scope;
- batch deduplication and machine-readable migration reports.

It does **not** yet execute plugin code or install generated DSH packages. A
scan result distinguishes capabilities that can enter the Tool wrapper path
from model providers and lifecycle extensions that require later adapters.

## Usage

```bash
npm install
npm run build
node dist/cli.js scan ./plugins --output migration-report.json
```

The scanner never extracts package contents to the current directory. It
rejects path traversal, symbolic links, excessive entry counts, oversized
entries, excessive aggregate size, and suspicious compression ratios.

## Migration dispositions

- `wrapped-native`: can be exposed through a generated native DSH plugin, with
  the original implementation isolated behind the DSH execution contract.
- `review-required`: understood, but needs a dedicated target adapter.
- `unsupported`: outside the current target runtime or unsafe to translate.
- `incompatible`: explicitly requires a Dify version newer than the target.

## Scope boundary

Arbitrary Python cannot be soundly translated into TypeScript. The planned
Tool compiler therefore emits a standard DSH plugin and, when necessary, owns
an isolated private worker. DSH remains the only registry, credential surface,
workflow node type, lifecycle owner, and audit boundary.

