# Architecture

The migrator is a compiler and administration plugin. It is not a permanent
Dify registry and does not mount Dify's plugin daemon.

```text
workflow DSL + .difypkg directory
                 |
                 v
        bounded package reader
                 |
                 v
       normalized Dify plugin IR
                 |
          +------+------+
          |             |
          v             v
  DSH capability    migration report
     compiler       and manual actions
          |
          v
  generated DSH plugin packages
          |
          v
  one DSH registry / credential surface / workflow node ABI
```

## Trust boundaries

- Scanning never imports or executes package Python.
- ZIP entries are read through bounded streams and are never extracted during
  inspection.
- Credentials are schemas only; values are not migrated.
- A Dify signature envelope is provenance until independently verified.
- Generated tools must execute through a DSH-owned isolation and timeout
  boundary before they can be marked runnable.

## Runtime policy

Arbitrary Python cannot be translated soundly to TypeScript. A generated Tool
plugin may own an isolated private worker. A recognized Xinference package is
instead compiled to metadata only and registered through the DSH LLM service;
its Python is never copied or executed. All public behavior remains DSH native:
registration, schemas, credentials, permissions, cancellation, timeouts,
logging, and workflow binding. There is no Dify marketplace, plugin-daemon, or
second capability registry at runtime.

