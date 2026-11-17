#!/usr/bin/env node
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { scanDifyPackages } from "./batch.js"
import { prepareBatchInputs } from "./batch-archive.js"
import { convertDifyPackages } from "./migration/batch-converter.js"

class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UsageError"
  }
}

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv
  if (command === "scan") {
    await scan(rest)
    return
  }
  if (command === "convert") {
    await convert(rest)
    return
  }
  usage(`Unknown command: ${command ?? "(none)"}`)
}

async function scan(args: readonly string[]): Promise<void> {
  const { inputs, output } = parseArgs(args)
  if (inputs.length === 0) usage("Provide at least one .difypkg file or directory")
  const prepared = await prepareBatchInputs(inputs)
  try {
    const report = await scanDifyPackages(prepared.inputs)
    const json = `${JSON.stringify(report, null, 2)}\n`
    if (output) {
      await writeFile(resolve(output), json, "utf8")
      process.stdout.write(`Wrote ${report.summary.discovered} package record(s) to ${resolve(output)}\n`)
    } else {
      process.stdout.write(json)
    }
    if (report.summary.failed > 0) process.exitCode = 2
  } finally {
    await prepared.dispose()
  }
}

async function convert(args: readonly string[]): Promise<void> {
  const { inputs, output, install, report: reportPath } = parseArgs(args)
  if (inputs.length === 0) usage("Provide at least one .difypkg file or directory")
  if (!output) usage("convert requires --output <directory>")
  const prepared = await prepareBatchInputs(inputs)
  try {
    const report = await convertDifyPackages(prepared.inputs, {
      outputDirectory: resolve(output),
      ...(install ? { installDirectory: resolve(install) } : {}),
    })
    const json = `${JSON.stringify(report, null, 2)}\n`
    if (reportPath) await writeFile(resolve(reportPath), json, "utf8")
    else process.stdout.write(json)
    if (report.summary.discovered === 0) usage("No .difypkg files were found")
    if (report.summary.failed > 0) process.exitCode = 2
  } finally {
    await prepared.dispose()
  }
}

function parseArgs(args: readonly string[]): { inputs: string[]; output?: string; install?: string; report?: string } {
  const inputs: string[] = []
  let output: string | undefined
  let install: string | undefined
  let report: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--output" || arg === "-o") {
      output = args[index + 1]
      if (!output) usage(`${arg} requires a path`)
      index += 1
      continue
    }
    if (arg === "--install") {
      install = args[index + 1]
      if (!install) usage(`${arg} requires a DSH data directory`)
      index += 1
      continue
    }
    if (arg === "--report") {
      report = args[index + 1]
      if (!report) usage(`${arg} requires a path`)
      index += 1
      continue
    }
    if (arg?.startsWith("-")) usage(`Unknown option: ${arg}`)
    if (arg) inputs.push(arg)
  }
  return { inputs, output, install, report }
}

function usage(message: string): never {
  throw new UsageError(message)
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof UsageError) {
    process.stderr.write(`${error.message}\n\nUsage:\n  dsh-dify-migrator scan <file-or-directory-or-batch.zip>... [--output report.json]\n  dsh-dify-migrator convert <file-or-directory-or-batch.zip>... --output <directory> [--install <dsh-data-directory>] [--report report.json]\n`)
  } else {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  }
  process.exitCode = 1
})

