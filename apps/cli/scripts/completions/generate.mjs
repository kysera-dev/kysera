#!/usr/bin/env node
/**
 * Generates kysera.bash / kysera.zsh / kysera.fish from the actual CLI
 * command tree in ../../src/commands.
 *
 * Usage: node generate.mjs
 *
 * Parsing relies on the repo convention that commands are registered as
 * single-line chained calls:
 *   const cmd = new Command('name')
 *     .description('...')
 *     .argument('<x>', '...')
 *     .option('-f, --flag <value>', '...')
 *     .action(...)
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const COMMANDS_DIR = join(HERE, '..', '..', 'src', 'commands')

// Top-level command groups registered in src/cli.ts (descriptions shown
// by `kysera --help`).
const GROUPS = [
  { name: 'migrate', desc: 'Database migration management' },
  { name: 'generate', desc: 'Code generation utilities', alias: 'g' },
  { name: 'db', desc: 'Database management utilities' },
  { name: 'health', desc: 'Database health monitoring' },
  { name: 'audit', desc: 'Audit logging and history' },
  { name: 'debug', desc: 'Debug and diagnostic utilities' },
  { name: 'query', desc: 'Query utilities and analysis' },
  { name: 'repository', desc: 'Repository pattern utilities' },
  { name: 'test', desc: 'Test environment management' },
  { name: 'plugin', desc: 'Plugin management' },
  { name: 'schema', desc: 'PostgreSQL schema management' }
]

// Program-level options (src/cli.ts + src/utils/global-options.ts)
const GLOBAL_OPTS = [
  opt('--verbose', 'Enable verbose output'),
  opt('-q, --quiet', 'Suppress non-essential output'),
  opt('--dry-run', 'Preview changes without executing'),
  opt('--config <path>', 'Path to configuration file'),
  opt('--no-color', 'Disable colored output'),
  opt('--json', 'Output results as JSON'),
  opt('--env <environment>', 'Environment (development/production/test)'),
  opt('-v, --version', 'Show CLI version'),
  opt('-h, --help', 'Display help')
]

const HELP_OPT = opt('-h, --help', 'Display help')

function unescapeSource(s) {
  return s.replace(/\\'/g, "'").replace(/\\\\/g, '\\')
}

function opt(flags, desc) {
  const m = flags.match(/^(?:(-[A-Za-z]),\s+)?(--[A-Za-z0-9][A-Za-z0-9-]*)(?:\s+[<[](.+?)[>\]])?$/)
  if (!m) throw new Error(`Unparsable option flags: ${flags}`)
  const placeholder = m[3] ? m[3].replace(/\.+$/, '') : null
  const enumMatch = desc.match(/\(([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)\)/)
  const values = enumMatch ? enumMatch[1].split('/') : null
  const long = m[2]
  const dirish =
    placeholder === 'path' &&
    (/director/i.test(desc) || /--dir/.test(long) || long === '--directory')
  const fileish =
    !dirish && (placeholder === 'path' || placeholder === 'file' || placeholder === 'files')
  return { short: m[1] ?? null, long, placeholder, desc, values, dirish, fileish }
}

function parseCommandFile(path) {
  const commands = []
  let cur = null
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const mNew = line.match(/new Command\('([^']+)'\)/)
    if (mNew) {
      cur = { name: mNew[1], desc: '', args: [], opts: [] }
      commands.push(cur)
    }
    if (!cur) continue
    if (/\.action\(/.test(line)) {
      cur = null
      continue
    }
    const mDesc = line.match(/\.description\('((?:[^'\\]|\\.)*)'/)
    if (mDesc && !cur.desc) cur.desc = unescapeSource(mDesc[1])
    const mArg = line.match(/\.argument\('([^']+)'/)
    if (mArg) cur.args.push(mArg[1])
    const mOpt = line.match(/\.option\(\s*'([^']+)'(?:\s*,\s*'((?:[^'\\]|\\.)*)')?/)
    if (mOpt) cur.opts.push(opt(mOpt[1], unescapeSource(mOpt[2] ?? '')))
  }
  return commands
}

function parseGroup(groupName) {
  const dir = join(COMMANDS_DIR, groupName)
  const subs = []
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.ts') || file === 'index.ts') continue
    subs.push(...parseCommandFile(join(dir, file)))
  }
  return subs
}

const tree = GROUPS.map(g => ({ ...g, subs: parseGroup(g.name) }))

// Leaf commands (no subcommands)
const initCmd = parseCommandFile(join(COMMANDS_DIR, 'init', 'index.ts'))[0]
const LEAVES = [
  { name: 'init', desc: 'Initialize a new Kysera project', args: initCmd.args, opts: initCmd.opts }
]

const ALL_TOP = [LEAVES[0], ...tree, { name: 'help', desc: 'Display help for command' }]

const topNames = ALL_TOP.map(c => c.name).join(' ')

/* ------------------------------------------------------------------ bash */

function bashOptsList(opts) {
  return [...new Set(opts.map(o => o.long))].join(' ')
}

let bash = `#!/usr/bin/env bash
# Bash completion for kysera CLI
# Generated from the CLI command tree by generate.mjs - do not edit by hand.
# Installation:
#   Copy this file to /etc/bash_completion.d/kysera or /usr/local/etc/bash_completion.d/kysera
#   Or source it in your ~/.bashrc: source /path/to/kysera.bash

_kysera_completions() {
    local cur prev words cword
    _init_completion || return

    local commands="${topNames}"
    local global_opts="${bashOptsList(GLOBAL_OPTS)}"

    local cmd="" sub=""
    if (( COMP_CWORD > 1 )); then cmd="\${COMP_WORDS[1]}"; fi
    if (( COMP_CWORD > 2 )); then sub="\${COMP_WORDS[2]}"; fi
    [[ "\${cmd}" == "g" ]] && cmd="generate"

    # Options with a known set of values
    case "\${prev}" in
        --config)
            _filedir '@(ts|mts|cts|js|mjs|cjs|json)'
            return 0
            ;;
        --env)
            COMPREPLY=( $(compgen -W "development production test" -- "\${cur}") )
            return 0
            ;;
    esac

    if [[ "\${cmd}" == "init" ]]; then
        case "\${prev}" in
            -t|--template)
                COMPREPLY=( $(compgen -W "basic api graphql monorepo" -- "\${cur}") )
                return 0
                ;;
            -d|--database)
                COMPREPLY=( $(compgen -W "postgres mysql sqlite" -- "\${cur}") )
                return 0
                ;;
            --package-manager)
                COMPREPLY=( $(compgen -W "npm pnpm yarn bun" -- "\${cur}") )
                return 0
                ;;
        esac
    fi

    # Top-level commands
    if (( COMP_CWORD == 1 )); then
        COMPREPLY=( $(compgen -W "\${commands} \${global_opts}" -- "\${cur}") )
        return 0
    fi

    # Subcommands per command group
    local subcommands=""
    case "\${cmd}" in
`
for (const g of tree) {
  bash += `        ${g.name}) subcommands="${g.subs.map(s => s.name).join(' ')}" ;;\n`
}
bash += `        help)
            COMPREPLY=( $(compgen -W "\${commands}" -- "\${cur}") )
            return 0
            ;;
    esac

    if [[ -n "\${subcommands}" ]] && (( COMP_CWORD == 2 )); then
        COMPREPLY=( $(compgen -W "\${subcommands}" -- "\${cur}") )
        return 0
    fi

    # Options per command / subcommand (long forms)
    local opts=""
    case "\${cmd}" in
`
for (const leaf of LEAVES) {
  if (leaf.opts.length > 0) {
    bash += `        ${leaf.name}) opts="${bashOptsList(leaf.opts)}" ;;\n`
  }
}
bash += `    esac
    case "\${cmd} \${sub}" in
`
for (const g of tree) {
  for (const s of g.subs) {
    bash += `        "${g.name} ${s.name}") opts="${bashOptsList(s.opts)}" ;;\n`
  }
}
bash += `    esac

    COMPREPLY=( $(compgen -W "\${opts} --help" -- "\${cur}") )
    return 0
}

# Register completion function
complete -F _kysera_completions kysera
`

/* ------------------------------------------------------------------- zsh */

function zshDescribeEntry(name, desc) {
  return `'${name}:${desc.replace(/'/g, '').replace(/:/g, '\\:')}'`
}

function zshSpec(o) {
  const desc = o.desc.replace(/\[/g, '(').replace(/\]/g, ')').replace(/'/g, '')
  let action = ''
  if (o.placeholder) {
    const label = o.placeholder.replace(/\s/g, '-')
    if (o.values) action = `:${label}:(${o.values.join(' ')})`
    else if (o.dirish) action = `:${label}:_files -/`
    else if (o.fileish) action = `:${label}:_files`
    else action = `:${label}:`
  }
  if (o.long === '--config' && o.placeholder) {
    action = `:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"`
  }
  if (o.short) return `'(${o.short} ${o.long})'{${o.short},${o.long}}'[${desc}]${action}'`
  return `'${o.long}[${desc}]${action}'`
}

function zshArguments(opts, indent, extraSpecs = []) {
  const specs = [...extraSpecs, ...opts.map(zshSpec), zshSpec(HELP_OPT)]
  return `${indent}_arguments \\\n${specs.map(s => `${indent}    ${s}`).join(' \\\n')}`
}

let zsh = `#compdef kysera
# Zsh completion for kysera CLI
# Generated from the CLI command tree by generate.mjs - do not edit by hand.
# Installation:
#   Copy this file to a directory in your $fpath (e.g., /usr/local/share/zsh/site-functions/_kysera)
#   Or add to your ~/.zshrc: fpath=(/path/to/completions $fpath) && autoload -U compinit && compinit

`
for (const g of tree) {
  zsh += `_kysera_${g.name.replace(/-/g, '_')}() {
    local -a subcmds
    subcmds=(
${g.subs.map(s => `        ${zshDescribeEntry(s.name, s.desc)}`).join('\n')}
    )
    if (( CURRENT == 2 )); then
        _describe -t commands '${g.name} subcommand' subcmds
        return
    fi
    case $words[2] in
`
  for (const s of g.subs) {
    const extra = []
    if (g.name === 'db' && s.name === 'restore') extra.push(`'1:dump file:_files'`)
    zsh += `        ${s.name})\n${zshArguments(s.opts, '            ', extra)}\n            ;;\n`
  }
  zsh += `    esac
}

`
}

zsh += `_kysera() {
    local -a commands
    commands=(
${ALL_TOP.map(c => `        ${zshDescribeEntry(c.name, c.desc)}`).join('\n')}
    )

    local -a global_opts
    global_opts=(
${GLOBAL_OPTS.map(o => `        ${zshSpec(o)}`).join('\n')}
    )

    _arguments -C \\
        '1: :->cmds' \\
        '*:: :->args' && return 0

    case $state in
        cmds)
            _describe -t commands 'kysera commands' commands
            _arguments $global_opts
            ;;
        args)
            case $words[1] in
`
for (const g of tree) {
  const pattern = g.alias ? `${g.name}|${g.alias}` : g.name
  zsh += `                ${pattern})
                    _kysera_${g.name.replace(/-/g, '_')}
                    ;;\n`
}
zsh += `                init)
${zshArguments(LEAVES[0].opts, '                    ', [`'1:project name:'`])}
                    ;;
                help)
                    _describe -t commands 'kysera commands' commands
                    ;;
            esac
            ;;
    esac
}

_kysera "$@"
`

/* ------------------------------------------------------------------ fish */

function fishEscape(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')
}

function fishOpt(cond, o) {
  let s = `complete -c kysera${cond ? ` -n "${cond}"` : ''}`
  if (o.short) s += ` -s ${o.short.slice(1)}`
  s += ` -l ${o.long.slice(2)}`
  if (o.placeholder) {
    if (o.long === '--config' || o.fileish || o.dirish) s += ' -r -F'
    else if (o.values) s += ` -x -a "${o.values.join(' ')}"`
    else s += ' -x'
  }
  s += ` -d "${fishEscape(o.desc)}"`
  return s
}

let fish = `# Fish completion for kysera CLI
# Generated from the CLI command tree by generate.mjs - do not edit by hand.
# Installation:
#   Copy this file to ~/.config/fish/completions/kysera.fish
#   Or copy to /usr/share/fish/vendor_completions.d/kysera.fish (system-wide)

# Remove any existing completions
complete -c kysera -e

# Global options (accepted before a command)
${GLOBAL_OPTS.map(o => fishOpt('__fish_use_subcommand', o)).join('\n')}

# Main commands
${ALL_TOP.map(c => `complete -c kysera -f -n "__fish_use_subcommand" -a ${c.name} -d "${fishEscape(c.desc)}"`).join('\n')}
complete -c kysera -f -n "__fish_use_subcommand" -a g -d "Code generation utilities (alias for generate)"
`

for (const g of tree) {
  const groupCond = g.alias
    ? `__fish_seen_subcommand_from ${g.name} ${g.alias}`
    : `__fish_seen_subcommand_from ${g.name}`
  const subNames = g.subs.map(s => s.name).join(' ')
  fish += `\n# ${g.name} subcommands\n`
  for (const s of g.subs) {
    fish += `complete -c kysera -f -n "${groupCond}; and not __fish_seen_subcommand_from ${subNames}" -a ${s.name} -d "${fishEscape(s.desc)}"\n`
  }
  for (const s of g.subs) {
    if (s.opts.length === 0) continue
    fish += `\n# ${g.name} ${s.name} options\n`
    const cond = `${groupCond}; and __fish_seen_subcommand_from ${s.name}`
    for (const o of s.opts) {
      fish += fishOpt(cond, o) + '\n'
    }
  }
}

for (const leaf of LEAVES) {
  if (leaf.opts.length === 0) continue
  fish += `\n# ${leaf.name} options\n`
  for (const o of leaf.opts) {
    fish += fishOpt(`__fish_seen_subcommand_from ${leaf.name}`, o) + '\n'
  }
}

fish += `\n# help completes command names\n`
for (const c of ALL_TOP) {
  if (c.name === 'help') continue
  fish += `complete -c kysera -f -n "__fish_seen_subcommand_from help" -a ${c.name} -d "${fishEscape(c.desc)}"\n`
}

writeFileSync(join(HERE, 'kysera.bash'), bash)
writeFileSync(join(HERE, 'kysera.zsh'), zsh)
writeFileSync(join(HERE, 'kysera.fish'), fish)

const total = tree.reduce((n, g) => n + g.subs.length, 0)
console.log(`Generated completions for ${ALL_TOP.length} top-level commands, ${total} subcommands.`)
for (const g of tree) {
  console.log(`  ${g.name}: ${g.subs.map(s => s.name).join(', ')}`)
}
