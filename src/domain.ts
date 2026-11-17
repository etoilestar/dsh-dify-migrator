export const TARGET_DIFY_VERSION = "1.13.3"
export const REPORT_SCHEMA_VERSION = "0.1.0"
export const DSH_TOOL_PACKAGE_SCHEMA_VERSION = 1

export type DifyPluginKind =
  | "tool"
  | "model"
  | "endpoint"
  | "agent-strategy"
  | "datasource"
  | "trigger"
  | "unknown"

export type MigrationDisposition =
  | "wrapped-native"
  | "review-required"
  | "unsupported"
  | "incompatible"

export interface DifyRunnerIR {
  language?: string
  version?: string
  entrypoint?: string
}

export interface DifyManifestIR {
  type: "plugin" | "bundle" | "unknown"
  author: string
  name: string
  version: string
  packageId: string
  schemaVersion?: string
  minimumDifyVersion?: string
  runner: DifyRunnerIR
  capabilityPaths: Partial<Record<DifyPluginKind, string[]>>
  capabilities: DifyPluginKind[]
  permissions: string[]
}

export interface DifyCredentialIR {
  name: string
  type: string
  required: boolean
  label: string
  secret: boolean
}

export interface DifyToolParameterIR {
  name: string
  type: string
  required: boolean
  form?: string
  description: string
  defaultValue?: unknown
  options?: Array<{ value: string; label: string }>
}

export interface DifyToolIR {
  name: string
  label: string
  description: string
  declarationPath: string
  implementationPath?: string
  parameters: DifyToolParameterIR[]
  outputSchema?: Record<string, unknown>
}

export interface DifyToolProviderIR {
  name: string
  label: string
  declarationPath: string
  implementationPath?: string
  credentials: DifyCredentialIR[]
  tools: DifyToolIR[]
}

export interface PackageEntryIR {
  path: string
  compressedBytes: number
  uncompressedBytes: number
}

export interface RawDifyPackage {
  sourcePath: string
  sha256: string
  byteLength: number
  signatureEnvelope?: Record<string, unknown>
  entries: PackageEntryIR[]
  textFiles: ReadonlyMap<string, string>
}

export type MigrationIssueSeverity = "info" | "warning" | "error"

export interface MigrationIssue {
  code: string
  severity: MigrationIssueSeverity
  message: string
}

export interface MigrationPlan {
  targetDifyVersion: string
  targetPluginId: string
  disposition: MigrationDisposition
  capabilities: DifyPluginKind[]
  issues: MigrationIssue[]
}

export interface BatchPackageRecord {
  sourcePath: string
  sha256?: string
  duplicateOf?: string
  manifest?: DifyManifestIR
  toolProviders?: DifyToolProviderIR[]
  plan?: MigrationPlan
  package?: {
    byteLength: number
    entryCount: number
    signatureEnvelopePresent: boolean
    signatureVerification: "not-verified"
  }
  error?: {
    code: string
    message: string
  }
}

export interface BatchMigrationReport {
  schemaVersion: string
  targetDifyVersion: string
  createdAt: string
  inputs: string[]
  packages: BatchPackageRecord[]
  summary: {
    discovered: number
    parsed: number
    failed: number
    unique: number
    duplicates: number
    dispositions: Partial<Record<MigrationDisposition, number>>
  }
}

export interface DshToolPackageCredential {
  name: string
  label: string
  required: boolean
  secret: boolean
}

export interface DshToolPackageTool {
  ref: string
  name: string
  label: string
  description: string
  provider: string
  implementationPath: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
}

export interface DshToolPackageManifest {
  schemaVersion: typeof DSH_TOOL_PACKAGE_SCHEMA_VERSION
  id: string
  name: string
  version: string
  description: string
  origin: {
    platform: "dify"
    targetVersion: string
    packageId: string
    sha256: string
    author: string
    plugin: string
  }
  runtime: {
    kind: "python-dify-tool-worker"
    command: string
    workerPath: string
    payloadPath: string
    timeoutMs: number
  }
  credentials: DshToolPackageCredential[]
  tools: DshToolPackageTool[]
}

export interface CompiledDshToolPackage {
  outputDirectory: string
  manifestPath: string
  manifest: DshToolPackageManifest
}

export type BatchConversionStatus = "installed" | "converted" | "skipped" | "duplicate" | "failed"

export interface BatchConversionRecord {
  sourcePath: string
  status: BatchConversionStatus
  sha256?: string
  duplicateOf?: string
  packageId?: string
  disposition?: MigrationDisposition
  outputDirectory?: string
  installedDirectory?: string
  dshPackageId?: string
  version?: string
  tools?: string[]
  credentials?: string[]
  error?: { code: string; message: string }
}

export interface BatchConversionReport {
  schemaVersion: "0.1.0"
  targetDifyVersion: string
  createdAt: string
  inputs: string[]
  packages: BatchConversionRecord[]
  summary: {
    discovered: number
    installed: number
    converted: number
    skipped: number
    duplicates: number
    failed: number
  }
}

