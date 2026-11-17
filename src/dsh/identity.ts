export function dshToolRef(author: string, plugin: string, tool: string): string {
  return `dsh_migrated__${segment(author)}__${segment(plugin)}__${segment(tool)}`
}

export function dshPackageId(author: string, plugin: string): string {
  return `dsh_dify__${segment(author)}__${segment(plugin)}`
}

function segment(value: string): string {
  const normalized = value.toLowerCase().normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
  return (normalized || "unknown").slice(0, 48)
}
