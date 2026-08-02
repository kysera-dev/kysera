#!/usr/bin/env bash
# Bash completion for kysera CLI
# Generated from the CLI command tree by generate.mjs - do not edit by hand.
# Installation:
#   Copy this file to /etc/bash_completion.d/kysera or /usr/local/etc/bash_completion.d/kysera
#   Or source it in your ~/.bashrc: source /path/to/kysera.bash

_kysera_completions() {
    local cur prev words cword
    _init_completion || return

    local commands="init doctor migrate generate db health audit debug query repository test plugin schema rls help"
    local global_opts="--verbose --quiet --dry-run --config --no-color --json --env --version --help"

    local cmd="" sub=""
    if (( COMP_CWORD > 1 )); then cmd="${COMP_WORDS[1]}"; fi
    if (( COMP_CWORD > 2 )); then sub="${COMP_WORDS[2]}"; fi
    [[ "${cmd}" == "g" ]] && cmd="generate"

    # Options with a known set of values
    case "${prev}" in
        --config)
            _filedir '@(ts|mts|cts|js|mjs|cjs|json)'
            return 0
            ;;
        --env)
            COMPREPLY=( $(compgen -W "development production test" -- "${cur}") )
            return 0
            ;;
    esac

    if [[ "${cmd}" == "init" ]]; then
        case "${prev}" in
            -t|--template)
                COMPREPLY=( $(compgen -W "basic api graphql monorepo" -- "${cur}") )
                return 0
                ;;
            -d|--database)
                COMPREPLY=( $(compgen -W "postgres mysql sqlite" -- "${cur}") )
                return 0
                ;;
            --package-manager)
                COMPREPLY=( $(compgen -W "npm pnpm yarn bun" -- "${cur}") )
                return 0
                ;;
        esac
    fi

    # Top-level commands
    if (( COMP_CWORD == 1 )); then
        COMPREPLY=( $(compgen -W "${commands} ${global_opts}" -- "${cur}") )
        return 0
    fi

    # Subcommands per command group
    local subcommands=""
    case "${cmd}" in
        migrate) subcommands="baseline create down list reset fresh status up verify" ;;
        generate) subcommands="crud database model repository schema" ;;
        db) subcommands="console dump introspect reset restore seed tables" ;;
        health) subcommands="check metrics watch" ;;
        audit) subcommands="cleanup compare diff history init logs restore stats" ;;
        debug) subcommands="analyzer circuit-breaker errors profile sql" ;;
        query) subcommands="analyze by-timestamp explain soft-deleted" ;;
        repository) subcommands="inspect list methods validate" ;;
        test) subcommands="fixtures seed setup teardown" ;;
        plugin) subcommands="config disable enable list" ;;
        schema) subcommands="clone compare create drop info list" ;;
        rls) subcommands="generate migration" ;;
        help)
            COMPREPLY=( $(compgen -W "${commands}" -- "${cur}") )
            return 0
            ;;
    esac

    if [[ -n "${subcommands}" ]] && (( COMP_CWORD == 2 )); then
        COMPREPLY=( $(compgen -W "${subcommands}" -- "${cur}") )
        return 0
    fi

    # Options per command / subcommand (long forms)
    local opts=""
    case "${cmd}" in
        init) opts="--template --database --plugins --package-manager --typescript --no-typescript --git --no-git --install --no-install" ;;
        doctor) opts="--json --config" ;;
    esac
    case "${cmd} ${sub}" in
        "migrate baseline") opts="--all --verbose --config --json --schema" ;;
        "migrate create") opts="--dir --directory --template --ts --no-ts --table --columns --json" ;;
        "migrate down") opts="--steps --to --all --dry-run --verbose --config --force --json --schema" ;;
        "migrate list") opts="--pending --executed --json --config --schema" ;;
        "migrate reset") opts="--force --run --seed --config --verbose --json --schema" ;;
        "migrate fresh") opts="--seed --force --config --verbose --json --schema" ;;
        "migrate status") opts="--json --verbose --config --schema" ;;
        "migrate up") opts="--to --steps --count --dry-run --verbose --config --json --schema" ;;
        "migrate verify") opts="--update --verbose --config --json --schema" ;;
        "generate crud") opts="--output-dir --overwrite --config --with-validation --no-with-validation --with-pagination --no-with-pagination --with-soft-delete --with-timestamps --no-with-timestamps --format --no-format --json --schema" ;;
        "generate database") opts="--output --config --schema --exclude --with-helpers --json" ;;
        "generate model") opts="--output --overwrite --config --timestamps --no-timestamps --soft-delete --json --schema" ;;
        "generate repository") opts="--output --overwrite --config --with-validation --no-with-validation --with-pagination --no-with-pagination --with-soft-delete --with-timestamps --no-with-timestamps --json --schema" ;;
        "generate schema") opts="--output --overwrite --config --strict --no-strict --json --schema" ;;
        "db console") opts="--execute --force --config" ;;
        "db dump") opts="--output --tables --data-only --schema-only --format --json --config --schema" ;;
        "db introspect") opts="--json --detailed --config --schema" ;;
        "db reset") opts="--force --seed --config --verbose --schema" ;;
        "db restore") opts="--force --config" ;;
        "db seed") opts="--file --directory --fresh --dry-run --transaction --config --verbose --json --schema" ;;
        "db tables") opts="--json --verbose --config --schema" ;;
        "health check") opts="--json --watch --interval --verbose --config" ;;
        "health metrics") opts="--json --period --config" ;;
        "health watch") opts="--interval --json --log --config --verbose" ;;
        "audit cleanup") opts="--older-than --table --dry-run --force --batch-size --config" ;;
        "audit compare") opts="--json --show-values --config" ;;
        "audit diff") opts="--json --unified --no-color --config" ;;
        "audit history") opts="--limit --show-values --json --reverse --config --schema" ;;
        "audit init") opts="--table --dialect-ddl --dir --config" ;;
        "audit logs") opts="--table --user --action --limit --since --until --entity-id --json --verbose --config --schema" ;;
        "audit restore") opts="--dry-run --force --json --config" ;;
        "audit stats") opts="--table --user --period --format --config" ;;
        "debug analyzer") opts="--query --table --explain --suggestions --indexes --statistics --json --config" ;;
        "debug circuit-breaker") opts="--action --service --threshold --timeout --watch --json --config" ;;
        "debug errors") opts="--since --until --limit --pattern --group-by --show-queries --json --config" ;;
        "debug profile") opts="--query --table --operation --iterations --warmup --show-plan --compare --json --config" ;;
        "debug sql") opts="--watch --filter --highlight --show-params --show-duration --limit --config" ;;
        "query analyze") opts="--query --file --format --show-indexes --show-statistics --suggestions --benchmark --json --config" ;;
        "query by-timestamp") opts="--table --column --from --to --last --order --limit --json --config" ;;
        "query explain") opts="--query --file --analyze --verbose --format --buffers --costs --timing --summary --json --config --schema" ;;
        "query soft-deleted") opts="--table --column --restore --purge --force --limit --json --config --schema" ;;
        "repository inspect") opts="--file --className --show-ast --show-dependencies --show-complexity --show-database --json --config" ;;
        "repository list") opts="--directory --pattern --show-methods --show-schemas --json --config" ;;
        "repository methods") opts="--repository --file --group-by --filter --show-signatures --show-examples --show-complexity --markdown --json --config" ;;
        "repository validate") opts="--directory --pattern --fix --strict --show-details --json --config" ;;
        "test fixtures") opts="--load --directory --format --save --list --validate --dependencies --checksum --tags --verbose --json --config" ;;
        "test seed") opts="--tables --count --clean --strategy --relationships --locale --seed --custom --verbose --json --config" ;;
        "test setup") opts="--environment --database --clean --force --migrate --seed --fixtures --parallel --isolation --verbose --json --config" ;;
        "test teardown") opts="--environment --database --force --keep-data --preserve-logs --clean-artifacts --pattern --verbose --json --config" ;;
        "plugin config") opts="--get --set --value --reset --show --edit --validate --export --import --json --config" ;;
        "plugin disable") opts="--all --force --keep-config --restart --json --config" ;;
        "plugin enable") opts="--all --force --configure --restart --json --config" ;;
        "plugin list") opts="--installed --available --enabled --disabled --category --search --show-details --json --config" ;;
        "schema clone") opts="--include-data --exclude --tenant --force --verbose --config" ;;
        "schema compare") opts="--json --verbose --config" ;;
        "schema create") opts="--tenant --if-not-exists --force --verbose --config" ;;
        "schema drop") opts="--cascade --if-exists --force --verbose --config" ;;
        "schema info") opts="--json --indexes --foreign-keys --verbose --config" ;;
        "schema list") opts="--json --tenant --verbose --config" ;;
        "rls generate") opts="--output --drop --functions --schema --policy-prefix --no-force --json --config" ;;
        "rls migration") opts="--dir --name --schema --policy-prefix --no-force --no-functions --config" ;;
    esac

    COMPREPLY=( $(compgen -W "${opts} --help" -- "${cur}") )
    return 0
}

# Register completion function
complete -F _kysera_completions kysera
