import { parse } from "yaml"
import {
  isSupportedXinferenceModelType,
  type DifyCredentialIR,
  type DifyManifestIR,
  type DifyModelProviderIR,
  type RawDifyPackage,
} from "../domain.js"
import { MigrationError } from "../errors.js"

export function parseModelProviders(pkg: RawDifyPackage, manifest: DifyManifestIR): DifyModelProviderIR[] {
  return (manifest.capabilityPaths.model ?? []).map((path) => parseModelProvider(pkg, path))
}

function parseModelProvider(pkg: RawDifyPackage, declarationPath: string): DifyModelProviderIR {
  const provider = parseYamlRecord(pkg, declarationPath)
  const name = requiredString(provider.provider, `${declarationPath}: provider`)
  const supportedModelTypes = stringArray(provider.supported_model_types)
  const schema = isRecord(provider.model_credential_schema) ? provider.model_credential_schema : {}
  const credentials = Array.isArray(schema.credential_form_schemas)
    ? schema.credential_form_schemas.map((value, index) => parseCredential(value, declarationPath, index))
    : []
  const variables = new Set(credentials.map((credential) => credential.name))
  const adapter = name === "xinference" && supportedModelTypes.some(isSupportedXinferenceModelType)
    && variables.has("server_url") && variables.has("model_uid")
    ? "xinference-openai-compatible"
    : "unsupported"
  return {
    name,
    label: localizedText(provider.label) || name,
    declarationPath,
    adapter,
    supportedModelTypes,
    credentials,
  }
}

function parseCredential(value: unknown, path: string, index: number): DifyCredentialIR & { defaultValue?: unknown } {
  if (!isRecord(value)) throw new MigrationError("MODEL_CREDENTIAL_INVALID", `${path}: credential ${index} must be a mapping`)
  const name = requiredString(value.variable, `${path}: credential ${index}.variable`)
  const type = optionalString(value.type) ?? "text-input"
  return {
    name,
    type,
    required: value.required === true,
    label: localizedText(value.label) || name,
    secret: type === "secret-input",
    ...(Object.hasOwn(value, "default") ? { defaultValue: value.default } : {}),
  }
}

function parseYamlRecord(pkg: RawDifyPackage, path: string): Record<string, unknown> {
  const source = pkg.textFiles.get(path)
  if (!source) throw new MigrationError("MODEL_PROVIDER_DECLARATION_MISSING", `Model provider declaration is missing or too large: ${path}`)
  try {
    const value: unknown = parse(source)
    if (!isRecord(value)) throw new Error("document is not a mapping")
    return value
  } catch (error) {
    throw new MigrationError("DECLARATION_INVALID_YAML", `Invalid YAML declaration: ${path}`, error)
  }
}

function localizedText(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (!isRecord(value)) return ""
  for (const key of ["en_US", "zh_Hans", "zh_Hant"]) {
    const candidate = optionalString(value[key])
    if (candidate) return candidate
  }
  return Object.values(value).find((item): item is string => typeof item === "string" && item.trim().length > 0)?.trim() ?? ""
}

function requiredString(value: unknown, field: string): string {
  const text = optionalString(value)
  if (!text) throw new MigrationError("DECLARATION_INVALID", `Required field is missing: ${field}`)
  return text
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
