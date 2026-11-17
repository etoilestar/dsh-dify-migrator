#!/usr/bin/env node
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { scanDifyPackages } from "./batch.js"

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv
  if (command !== "scan") usage("Only the scan command is currently available")
  const { inputs, output } = parseScanArgs(rest)
  if (inputs.length === 0) usage("Provide at least one .difypkg file or directory")
  const report = await scanDifyPackages(inputs)
  const json = `${JSON.stringify(report, null, 2)}\n`
  if (output) {
    await writeFile(resolve(output), json, "utf8")
    process.stdout.write(`Wrote ${report.summary.discovered} package record(s) to ${resolve(output)}\n`)
  } else {
    process.stdout.write(json)
  }
  if (report.summary.failed > 0) process.exitCode = 2
}

function parseScanArgs(args: readonly string[]): { inputs: string[]; output?: string } {
  const inputs: string[] = []
  let output: string | undefined
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--output" || arg === "-o") {
      output = args[index + 1]
      if (!output) usage(`${arg} requires a path`)
      index += 1
      continue
    }
    if (arg?.startsWith("-")) usage(`Unknown option: ${arg}`)
    if (arg) inputs.push(arg)
  }
  return { inputs, output }
}

function usage(message: string): never {
  process.stderr.write(`${message}\n\nUsage: dsh-dify-migrator scan <file-or-directory>... [--output report.json]\n`)
  process.exit(1)
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})

