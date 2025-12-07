#!/usr/bin/env bash
# Bash completion for kysera CLI
# Installation:
#   Copy this file to /etc/bash_completion.d/kysera or /usr/local/etc/bash_completion.d/kysera
#   Or source it in your ~/.bashrc: source /path/to/kysera.bash

_kysera_completions() {
    local cur prev words cword
    _init_completion || return

    local commands="init migrate generate db health audit debug query repository test plugin help"

    # Get the command (first argument after 'kysera')
    local cmd=""
    if [[ ${COMP_CWORD} -gt 1 ]]; then
        cmd="${COMP_WORDS[1]}"
    fi

    case "${prev}" in
        kysera)
            COMPREPLY=( $(compgen -W "${commands}" -- ${cur}) )
            return 0
            ;;
        migrate|m)
            COMPREPLY=( $(compgen -W "create up down status list reset fresh rollback" -- ${cur}) )
            return 0
            ;;
        generate|g)
            COMPREPLY=( $(compgen -W "model repository schema crud migration" -- ${cur}) )
            return 0
            ;;
        db)
            COMPREPLY=( $(compgen -W "seed reset tables dump restore introspect console" -- ${cur}) )
            return 0
            ;;
        health)
            COMPREPLY=( $(compgen -W "check watch metrics" -- ${cur}) )
            return 0
            ;;
        audit)
            COMPREPLY=( $(compgen -W "logs history restore stats cleanup compare diff" -- ${cur}) )
            return 0
            ;;
        debug)
            COMPREPLY=( $(compgen -W "connection schema queries slow-queries explain" -- ${cur}) )
            return 0
            ;;
        query)
            COMPREPLY=( $(compgen -W "analyze explain optimize index suggest" -- ${cur}) )
            return 0
            ;;
        repository)
            COMPREPLY=( $(compgen -W "list create scaffold validate test" -- ${cur}) )
            return 0
            ;;
        test)
            COMPREPLY=( $(compgen -W "setup teardown seed fixtures run" -- ${cur}) )
            return 0
            ;;
        plugin)
            COMPREPLY=( $(compgen -W "list install uninstall enable disable info" -- ${cur}) )
            return 0
            ;;
        --dialect)
            COMPREPLY=( $(compgen -W "postgres mysql sqlite" -- ${cur}) )
            return 0
            ;;
        --validation)
            COMPREPLY=( $(compgen -W "zod yup joi none" -- ${cur}) )
            return 0
            ;;
        --strategy)
            COMPREPLY=( $(compgen -W "realistic minimal random faker" -- ${cur}) )
            return 0
            ;;
        --env)
            COMPREPLY=( $(compgen -W "development test production" -- ${cur}) )
            return 0
            ;;
        --config)
            # Complete file paths for config
            _filedir '@(ts|js|json)'
            return 0
            ;;
        --output|--dir|--directory)
            # Complete directory paths
            _filedir -d
            return 0
            ;;
        *)
            # Suggest global options and command-specific flags
            local global_opts="--help --version --verbose --quiet --dry-run --json --config --no-color"

            case "${cmd}" in
                init)
                    COMPREPLY=( $(compgen -W "${global_opts} --dialect --typescript --javascript --with-examples --skip-git" -- ${cur}) )
                    ;;
                migrate)
                    COMPREPLY=( $(compgen -W "${global_opts} --name --table --all --step --to" -- ${cur}) )
                    ;;
                generate)
                    COMPREPLY=( $(compgen -W "${global_opts} --table --output --with-validation --with-tests --api --crud" -- ${cur}) )
                    ;;
                db)
                    COMPREPLY=( $(compgen -W "${global_opts} --force --output --format --env" -- ${cur}) )
                    ;;
                health)
                    COMPREPLY=( $(compgen -W "${global_opts} --interval --format --threshold" -- ${cur}) )
                    ;;
                audit)
                    COMPREPLY=( $(compgen -W "${global_opts} --from --to --entity --limit --format" -- ${cur}) )
                    ;;
                test)
                    COMPREPLY=( $(compgen -W "${global_opts} --env --count --strategy --force" -- ${cur}) )
                    ;;
                plugin)
                    COMPREPLY=( $(compgen -W "${global_opts} --global --save" -- ${cur}) )
                    ;;
                *)
                    COMPREPLY=( $(compgen -W "${commands} ${global_opts}" -- ${cur}) )
                    ;;
            esac
            return 0
            ;;
    esac
}

# Register completion function
complete -F _kysera_completions kysera
