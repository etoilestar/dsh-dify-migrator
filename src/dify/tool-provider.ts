import { parse } from "yaml"
import type {
  DifyCredentialIR,
  DifyManifestIR,
  DifyToolIR,
  DifyToolParameterIR,
  DifyToolProviderIR,
  RawDifyPackage,
} from "../domain.js"
import { MigrationError } from "../errors.js"

export function parseToolProviders(pkg: RawDifyPackage, manifest: DifyManifestIR): DifyToolProviderIR[] {
  const providerPaths = manifest.capabilityPaths.tool ?? []
  return providerPaths.map((providerPath) => parseToolProvider(pkg, providerPath))
}

function parseToolProvider(pkg: RawDifyPackage, providerPath: string): DifyToolProviderIR {
  const provider = parseYamlRecord(pkg, providerPath, "TOOL_PROVIDER_DECLARATION_MISSING")
  const identity = isRecord(provider.identity) ? provider.identity : {}
  const extra = isRecord(provider.extra) ? provider.extra : {}
  const python = isRecord(extra.python) ? extra.python : {}
  const toolPaths = stringArray(provider.tools)
  if (toolPaths.length === 0) {
    throw new MigrationError("TOOL_LIST_EMPTY", `Tool provider has no tool declarations: ${providerPath}`)
  }
  return {
    name: requiredString(identity.name, `${providerPath}: identity.name`),
    label: localizedText(identity.label) || requiredString(identity.name, `${providerPath}: identity.name`),
    declarationPath: providerPath,
    implementationPath: optionalString(python.source),
    credentials: parseCredentials(provider.credentials_for_provider),
    tools: toolPaths.map((toolPath) => parseTool(pkg, toolPath)),
  }
}

function parseTool(pkg: RawDifyPackage, toolPath: string): DifyToolIR {
  const tool = parseYamlRecord(pkg, toolPath, "TOOL_DECLARATION_MISSING")
  const identity = isRecord(tool.identity) ? tool.identity : {}
  const description = isRecord(tool.description) ? tool.description : {}
  const extra = isRecord(tool.extra) ? tool.extra : {}
  const python = isRecord(extra.python) ? extra.python : {}
  const rawOutputSchema = isRecord(tool.output_schema) ? tool.output_schema : undefined
  return {
    name: requiredString(identity.name, `${toolPath}: identity.name`),
    label: localizedText(identity.label) || requiredString(identity.name, `${toolPath}: identity.name`),
    description: optionalString(description.llm) ?? localizedText(description.human),
    declarationPath: toolPath,
    implementationPath: optionalString(python.source),
    parameters: Array.isArray(tool.parameters) ? tool.parameters.map((parameter, index) => parseParameter(parameter, toolPath, index)) : [],
    ...(rawOutputSchema ? { outputSchema: rawOutputSchema } : {}),
  }
}

function parseCredentials(value: unknown): DifyCredentialIR[] {
  if (!isRecord(value)) return []
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([name, raw]) => {
    const credential = isRecord(raw) ? raw : {}
    const type = optionalString(credential.type) ?? "text-input"
    return {
      name,
      type,
      required: credential.required === true,
      label: localizedText(credential.label) || name,
      secret: type === "secret-input",
    }
  })
}

function parseParameter(value: unknown, toolPath: string, index: number): DifyToolParameterIR {
  if (!isRecord(value)) throw new MigrationError("TOOL_PARAMETER_INVALID", `${toolPath}: parameter ${index} must be a mapping`)
  const name = requiredString(value.name, `${toolPath}: parameters[${index}].name`)
  const options = Array.isArray(value.options)
    ? value.options.flatMap((option) => {
      if (!isRecord(option) || typeof option.value !== "string") return []
      return [{ value: option.value, label: localizedText(option.label) || option.value }]
    })
    : undefined
  return {
    name,
    type: requiredString(value.type, `${toolPath}: parameters[${index}].type`),
    required: value.required === true,
    form: optionalString(value.form),
    description: optionalString(value.llm_description) ?? localizedText(value.human_description),
    ...(Object.hasOwn(value, "default") ? { defaultValue: value.default } : {}),
    ...(options && options.length > 0 ? { options } : {}),
  }
}

function parseYamlRecord(pkg: RawDifyPackage, path: string, missingCode: string): Record<string, unknown> {
  const source = pkg.textFiles.get(path)
  if (!source) throw new MigrationError(missingCode, `Package declaration is missing or too large: ${path}`)
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

