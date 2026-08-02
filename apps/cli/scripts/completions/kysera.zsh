#compdef kysera
# Zsh completion for kysera CLI
# Generated from the CLI command tree by generate.mjs - do not edit by hand.
# Installation:
#   Copy this file to a directory in your $fpath (e.g., /usr/local/share/zsh/site-functions/_kysera)
#   Or add to your ~/.zshrc: fpath=(/path/to/completions $fpath) && autoload -U compinit && compinit

_kysera_migrate() {
    local -a subcmds
    subcmds=(
        'create:Create a new migration file'
        'down:Rollback migrations'
        'list:List all migrations'
        'reset:Reset all migrations (dangerous!)'
        'fresh:Drop all tables and re-run migrations'
        'status:Show migration status'
        'up:Run pending migrations'
    )
    if (( CURRENT == 2 )); then
        _describe -t commands 'migrate subcommand' subcmds
        return
    fi
    case $words[2] in
        create)
            _arguments \
                '(-d --dir)'{-d,--dir}'[Migration directory]:path:_files -/' \
                '--directory[Migration directory (alias for --dir)]:path:_files -/' \
                '(-t --template)'{-t,--template}'[Migration template]:type:' \
                '--ts[Generate TypeScript file]' \
                '--no-ts[Generate JavaScript file]' \
                '--table[Table name for table-based templates]:name:' \
                '--columns[Comma-separated column definitions (name:type:nullable:default)]:list:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        down)
            _arguments \
                '--steps[Number of migrations to rollback]:number:' \
                '--count[Number of migrations to rollback (alias for --steps)]:number:' \
                '(-t --to)'{-t,--to}'[Rollback to specific migration]:migration:' \
                '--all[Rollback all migrations]' \
                '--dry-run[Preview rollback without executing]' \
                '(-v --verbose)'{-v,--verbose}'[Show detailed output]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '--force[Skip confirmation prompt]' \
                '--json[Output results as JSON]' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        list)
            _arguments \
                '--pending[Show only pending migrations]' \
                '--executed[Show only executed migrations]' \
                '--json[Output as JSON]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        reset)
            _arguments \
                '--force[Skip confirmation prompt]' \
                '--run[Re-run migrations after reset]' \
                '--seed[Run seeds after reset]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-v --verbose)'{-v,--verbose}'[Show detailed output]' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        fresh)
            _arguments \
                '--seed[Run seeds after migration]' \
                '--force[Skip confirmation prompt]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-v --verbose)'{-v,--verbose}'[Show detailed output]' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        status)
            _arguments \
                '--json[Output as JSON]' \
                '(-v --verbose)'{-v,--verbose}'[Show detailed information]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        up)
            _arguments \
                '(-t --to)'{-t,--to}'[Migrate up to specific migration]:migration:' \
                '--steps[Number of migrations to run]:number:' \
                '--count[Number of migrations to run (alias for --steps)]:number:' \
                '--dry-run[Preview migrations without executing]' \
                '--force[Force migration even if already executed]' \
                '(-v --verbose)'{-v,--verbose}'[Show detailed output]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '--json[Output results as JSON]' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
    esac
}

_kysera_generate() {
    local -a subcmds
    subcmds=(
        'crud:Generate complete CRUD stack (model, repository, schema) for a table'
        'model:Generate TypeScript model from database table'
        'repository:Generate repository from database table'
        'schema:Generate Zod schema from database table'
    )
    if (( CURRENT == 2 )); then
        _describe -t commands 'generate subcommand' subcmds
        return
    fi
    case $words[2] in
        crud)
            _arguments \
                '(-o --output-dir)'{-o,--output-dir}'[Base output directory]:path:_files -/' \
                '--overwrite[Overwrite existing files]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '--with-validation[Include Zod validation]' \
                '--no-with-validation[Skip Zod validation]' \
                '--with-pagination[Include pagination methods]' \
                '--no-with-pagination[Skip pagination methods]' \
                '--with-soft-delete[Include soft delete support]' \
                '--with-timestamps[Include timestamp support]' \
                '--no-with-timestamps[Skip timestamp support]' \
                '--format[Format generated files with Prettier]' \
                '--no-format[Skip formatting]' \
                '--json[Output results as JSON]' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        model)
            _arguments \
                '(-o --output)'{-o,--output}'[Output directory]:path:_files -/' \
                '--overwrite[Overwrite existing files]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '--timestamps[Include timestamp fields]' \
                '--no-timestamps[Exclude timestamp fields]' \
                '--soft-delete[Include soft delete fields]' \
                '--json[Output results as JSON]' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        repository)
            _arguments \
                '(-o --output)'{-o,--output}'[Output directory]:path:_files -/' \
                '--overwrite[Overwrite existing files]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '--with-validation[Include Zod validation]' \
                '--no-with-validation[Skip Zod validation]' \
                '--with-pagination[Include pagination methods]' \
                '--no-with-pagination[Skip pagination methods]' \
                '--with-soft-delete[Include soft delete support]' \
                '--with-timestamps[Include timestamp support]' \
                '--no-with-timestamps[Skip timestamp support]' \
                '--json[Output results as JSON]' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        schema)
            _arguments \
                '(-o --output)'{-o,--output}'[Output directory]:path:_files -/' \
                '--overwrite[Overwrite existing files]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '--strict[Use strict validation (no unknown keys)]' \
                '--no-strict[Allow unknown keys in validation]' \
                '--json[Output results as JSON]' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
    esac
}

_kysera_db() {
    local -a subcmds
    subcmds=(
        'console:Open interactive database console'
        'dump:Export database dump'
        'introspect:Introspect database schema'
        'reset:Reset database (drop all tables and re-run migrations)'
        'restore:Restore database from dump'
        'seed:Run database seeders'
        'tables:List all database tables with statistics'
    )
    if (( CURRENT == 2 )); then
        _describe -t commands 'db subcommand' subcmds
        return
    fi
    case $words[2] in
        console)
            _arguments \
                '(-e --execute)'{-e,--execute}'[Execute SQL query and exit]:sql:' \
                '--force[Skip confirmation for destructive queries]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        dump)
            _arguments \
                '(-o --output)'{-o,--output}'[Output file path]:file:_files' \
                '(-t --tables)'{-t,--tables}'[Comma-separated table names]:list:' \
                '--data-only[Export data only (no schema)]' \
                '--schema-only[Export schema only (no data)]' \
                '(-f --format)'{-f,--format}'[Format (sql/json)]:type:(sql json)' \
                '--json[Output dump summary as JSON]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        introspect)
            _arguments \
                '--json[Output as JSON]' \
                '--detailed[Show detailed information]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        reset)
            _arguments \
                '--force[Skip confirmation prompt]' \
                '--seed[Run seeds after reset]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-v --verbose)'{-v,--verbose}'[Show detailed output]' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        restore)
            _arguments \
                '1:dump file:_files' \
                '--force[Skip confirmation prompt]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        seed)
            _arguments \
                '(-f --file)'{-f,--file}'[Specific seed file to run]:path:_files' \
                '(-d --directory)'{-d,--directory}'[Seed files directory]:path:_files -/' \
                '--fresh[Truncate tables before seeding]' \
                '--dry-run[Show what would be executed without making changes]' \
                '--transaction[Run all seeds in a single transaction]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-v --verbose)'{-v,--verbose}'[Show detailed output]' \
                '--json[Output results as JSON]' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        tables)
            _arguments \
                '--json[Output as JSON]' \
                '(-v --verbose)'{-v,--verbose}'[Show detailed info (columns, indexes, etc.)]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
    esac
}

_kysera_health() {
    local -a subcmds
    subcmds=(
        'check:Perform a health check'
        'metrics:Show detailed database metrics'
        'watch:Continuous health monitoring'
    )
    if (( CURRENT == 2 )); then
        _describe -t commands 'health subcommand' subcmds
        return
    fi
    case $words[2] in
        check)
            _arguments \
                '--json[Output as JSON]' \
                '--watch[Watch mode (continuous monitoring)]' \
                '--interval[Check interval in ms]:ms:' \
                '(-v --verbose)'{-v,--verbose}'[Show detailed metrics]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        metrics)
            _arguments \
                '--json[Output as JSON]' \
                '--period[Time period (1h, 24h, 7d)]:period:' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        watch)
            _arguments \
                '--interval[Check interval in ms]:ms:' \
                '--json[Output as JSON]' \
                '--log[Log to file]:file:_files' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-v --verbose)'{-v,--verbose}'[Show detailed metrics]' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
    esac
}

_kysera_audit() {
    local -a subcmds
    subcmds=(
        'cleanup:Clean up old audit logs'
        'compare:Compare two audit log entries'
        'diff:Show entity diff between audit entries'
        'history:Show entity history timeline'
        'logs:Query audit logs with filters'
        'restore:Restore entity from audit log'
        'stats:Show audit statistics'
    )
    if (( CURRENT == 2 )); then
        _describe -t commands 'audit subcommand' subcmds
        return
    fi
    case $words[2] in
        cleanup)
            _arguments \
                '--older-than[Delete logs older than duration (30d, 3m, 1y)]:duration:' \
                '(-t --table)'{-t,--table}'[Clean specific table only]:name:' \
                '--dry-run[Preview cleanup without deleting]' \
                '--force[Skip confirmation prompt]' \
                '--batch-size[Delete in batches]:n:' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        compare)
            _arguments \
                '--json[Output as JSON]' \
                '--show-values[Show full field values]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        diff)
            _arguments \
                '--json[Output as JSON]' \
                '(-u --unified)'{-u,--unified}'[Show unified diff format]' \
                '--no-color[Disable colored output]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        history)
            _arguments \
                '(-l --limit)'{-l,--limit}'[Limit number of results]:n:' \
                '--show-values[Show changed values]' \
                '--json[Output as JSON]' \
                '--reverse[Show oldest first (default: newest first)]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        logs)
            _arguments \
                '(-t --table)'{-t,--table}'[Filter by table name]:name:' \
                '(-u --user)'{-u,--user}'[Filter by user ID]:id:' \
                '(-a --action)'{-a,--action}'[Filter by action (INSERT/UPDATE/DELETE)]:type:(INSERT UPDATE DELETE)' \
                '(-l --limit)'{-l,--limit}'[Limit number of results]:n:' \
                '--since[Show logs since datetime (ISO 8601)]:datetime:' \
                '--until[Show logs until datetime (ISO 8601)]:datetime:' \
                '(-e --entity-id)'{-e,--entity-id}'[Filter by entity ID]:id:' \
                '--json[Output as JSON]' \
                '(-v --verbose)'{-v,--verbose}'[Show detailed information including changes]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        restore)
            _arguments \
                '--dry-run[Preview restore without executing]' \
                '--force[Skip confirmation prompt]' \
                '--json[Output as JSON]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        stats)
            _arguments \
                '(-t --table)'{-t,--table}'[Filter by table name]:name:' \
                '(-u --user)'{-u,--user}'[Filter by user ID]:id:' \
                '(-p --period)'{-p,--period}'[Time period (1h, 1d, 1w, 1m)]:duration:' \
                '(-f --format)'{-f,--format}'[Output format (table/json/chart)]:type:(table json chart)' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
    esac
}

_kysera_debug() {
    local -a subcmds
    subcmds=(
        'analyzer:Query analyzer with optimization suggestions'
        'circuit-breaker:Circuit breaker monitoring and management'
        'errors:Error analysis and pattern detection'
        'profile:Query profiling and performance analysis'
        'sql:Real-time SQL query monitoring and debugging'
    )
    if (( CURRENT == 2 )); then
        _describe -t commands 'debug subcommand' subcmds
        return
    fi
    case $words[2] in
        analyzer)
            _arguments \
                '(-q --query)'{-q,--query}'[SQL query to analyze]:sql:' \
                '(-t --table)'{-t,--table}'[Analyze queries for specific table]:name:' \
                '(-e --explain)'{-e,--explain}'[Show execution plan]' \
                '(-s --suggestions)'{-s,--suggestions}'[Show optimization suggestions]' \
                '(-i --indexes)'{-i,--indexes}'[Analyze index usage]' \
                '--statistics[Show table statistics]' \
                '--json[Output as JSON]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        circuit-breaker)
            _arguments \
                '(-a --action)'{-a,--action}'[Action to perform (status/reset/open/close)]:type:(status reset open close)' \
                '(-s --service)'{-s,--service}'[Service name (database/cache/api)]:name:(database cache api)' \
                '(-t --threshold)'{-t,--threshold}'[Error threshold for opening circuit]:n:' \
                '--timeout[Reset timeout in milliseconds]:ms:' \
                '(-w --watch)'{-w,--watch}'[Watch mode - monitor in real-time]' \
                '--json[Output as JSON]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        errors)
            _arguments \
                '(-s --since)'{-s,--since}'[Show errors since datetime (ISO 8601)]:datetime:' \
                '--until[Show errors until datetime (ISO 8601)]:datetime:' \
                '(-l --limit)'{-l,--limit}'[Limit number of results]:n:' \
                '(-p --pattern)'{-p,--pattern}'[Filter errors by pattern]:regex:' \
                '(-g --group-by)'{-g,--group-by}'[Group errors by field (error/table/operation/user)]:field:(error table operation user)' \
                '--show-queries[Show failing queries]' \
                '--json[Output as JSON]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        profile)
            _arguments \
                '(-q --query)'{-q,--query}'[SQL query to profile]:sql:' \
                '(-t --table)'{-t,--table}'[Profile queries on specific table]:name:' \
                '(-o --operation)'{-o,--operation}'[Operation type (select/insert/update/delete)]:type:(select insert update delete)' \
                '(-i --iterations)'{-i,--iterations}'[Number of iterations]:n:' \
                '(-w --warmup)'{-w,--warmup}'[Number of warmup runs]:n:' \
                '--show-plan[Show query execution plan]' \
                '--compare[Compare with another query]:query:' \
                '--json[Output as JSON]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        sql)
            _arguments \
                '(-w --watch)'{-w,--watch}'[Watch mode - monitor queries in real-time]' \
                '(-f --filter)'{-f,--filter}'[Filter queries by pattern (regex)]:pattern:' \
                '(-h --highlight)'{-h,--highlight}'[Highlight specific keywords]:keyword:' \
                '--show-params[Show query parameters]' \
                '--show-duration[Show query execution time]' \
                '(-l --limit)'{-l,--limit}'[Limit number of queries to show]:n:' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
    esac
}

_kysera_query() {
    local -a subcmds
    subcmds=(
        'analyze:Analyze query performance and provide optimization suggestions'
        'by-timestamp:Query records by timestamp'
        'explain:Show and analyze query execution plans'
        'soft-deleted:Query and manage soft-deleted records'
    )
    if (( CURRENT == 2 )); then
        _describe -t commands 'query subcommand' subcmds
        return
    fi
    case $words[2] in
        analyze)
            _arguments \
                '(-q --query)'{-q,--query}'[SQL query to analyze]:sql:' \
                '(-f --file)'{-f,--file}'[Read query from file]:path:_files' \
                '--format[Output format (simple/detailed/json)]:type:(simple detailed json)' \
                '(-i --show-indexes)'{-i,--show-indexes}'[Show index usage information]' \
                '(-s --show-statistics)'{-s,--show-statistics}'[Show table statistics]' \
                '--suggestions[Show optimization suggestions]' \
                '(-b --benchmark)'{-b,--benchmark}'[Benchmark query N times]:n:' \
                '--json[Output results as JSON (same as --format json)]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        by-timestamp)
            _arguments \
                '(-t --table)'{-t,--table}'[Table name to query]:name:' \
                '(-c --column)'{-c,--column}'[Timestamp column name]:name:' \
                '--from[Start date (ISO format)]:date:' \
                '--to[End date (ISO format)]:date:' \
                '--last[Last N hours/days/weeks (e.g., 24h, 7d, 2w)]:duration:' \
                '--order[Sort order (asc/desc)]:dir:(asc desc)' \
                '(-l --limit)'{-l,--limit}'[Limit results]:n:' \
                '--json[Output as JSON]' \
                '--config[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        explain)
            _arguments \
                '(-q --query)'{-q,--query}'[SQL query to explain]:sql:' \
                '(-f --file)'{-f,--file}'[Read query from file]:path:_files' \
                '(-a --analyze)'{-a,--analyze}'[Execute query and show actual times]' \
                '(-v --verbose)'{-v,--verbose}'[Show verbose output]' \
                '--format[Output format (text/json/tree/yaml)]:type:(text json tree yaml)' \
                '--buffers[Show buffer usage (PostgreSQL)]' \
                '--costs[Show cost estimates]' \
                '--timing[Show timing information]' \
                '--summary[Show summary at the end]' \
                '--json[Output results as JSON (same as --format json)]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        soft-deleted)
            _arguments \
                '(-t --table)'{-t,--table}'[Table name to query]:name:' \
                '(-c --column)'{-c,--column}'[Soft delete column name]:name:' \
                '(-r --restore)'{-r,--restore}'[Restore a soft-deleted record by ID]:id:' \
                '--purge[Permanently delete soft-deleted records]' \
                '--force[Skip confirmation for purge]' \
                '(-l --limit)'{-l,--limit}'[Limit results]:n:' \
                '--json[Output as JSON]' \
                '--config[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-s --schema)'{-s,--schema}'[PostgreSQL schema name (default: public)]:name:' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
    esac
}

_kysera_repository() {
    local -a subcmds
    subcmds=(
        'inspect:Inspect a repository class in detail'
        'list:List all repository classes in the project'
        'methods:Show available methods in repository classes'
        'validate:Validate repository schemas against database'
    )
    if (( CURRENT == 2 )); then
        _describe -t commands 'repository subcommand' subcmds
        return
    fi
    case $words[2] in
        inspect)
            _arguments \
                '(-f --file)'{-f,--file}'[Repository file to inspect]:path:_files' \
                '(-c --className)'{-c,--className}'[Repository class name]:name:' \
                '--show-ast[Show abstract syntax tree]' \
                '--show-dependencies[Show dependencies graph]' \
                '--show-complexity[Show complexity metrics]' \
                '--show-database[Show database table info]' \
                '--json[Output as JSON]' \
                '--config[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        list)
            _arguments \
                '(-d --directory)'{-d,--directory}'[Directory to scan]:path:_files -/' \
                '(-p --pattern)'{-p,--pattern}'[File pattern to match]:glob:' \
                '--show-methods[Show repository methods]' \
                '--show-schemas[Show entity schemas]' \
                '--json[Output as JSON]' \
                '--config[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        methods)
            _arguments \
                '(-r --repository)'{-r,--repository}'[Repository class name]:name:' \
                '(-f --file)'{-f,--file}'[Repository file path]:path:_files' \
                '(-g --group-by)'{-g,--group-by}'[Group methods by (visibility/type/category)]:type:(visibility type category)' \
                '--filter[Filter methods by name pattern]:pattern:' \
                '--show-signatures[Show full method signatures]' \
                '--show-examples[Show usage examples]' \
                '--show-complexity[Show complexity metrics]' \
                '--markdown[Output as markdown documentation]' \
                '--json[Output as JSON]' \
                '--config[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        validate)
            _arguments \
                '(-d --directory)'{-d,--directory}'[Directory to scan]:path:_files -/' \
                '(-p --pattern)'{-p,--pattern}'[File pattern to match]:glob:' \
                '--fix[Attempt to fix issues]' \
                '--strict[Enable strict validation]' \
                '--show-details[Show detailed validation results]' \
                '--json[Output as JSON]' \
                '--config[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
    esac
}

_kysera_test() {
    local -a subcmds
    subcmds=(
        'fixtures:Load and manage test fixtures'
        'seed:Seed test database with sample data'
        'setup:Set up test database and environment'
        'teardown:Clean up test databases and artifacts'
    )
    if (( CURRENT == 2 )); then
        _describe -t commands 'test subcommand' subcmds
        return
    fi
    case $words[2] in
        fixtures)
            _arguments \
                '(-l --load)'{-l,--load}'[Load specific fixture files]:files:_files' \
                '(-d --directory)'{-d,--directory}'[Fixtures directory]:path:_files -/' \
                '(-f --format)'{-f,--format}'[Fixture format]:type:' \
                '(-s --save)'{-s,--save}'[Save current data as fixture]:name:' \
                '--list[List available fixtures]' \
                '--validate[Validate fixtures without loading]' \
                '--dependencies[Load fixture dependencies]' \
                '--checksum[Verify fixture checksums]' \
                '--tags[Filter by tags]:tags:' \
                '(-v --verbose)'{-v,--verbose}'[Verbose output]' \
                '--json[Output as JSON]' \
                '--config[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        seed)
            _arguments \
                '(-t --tables)'{-t,--tables}'[Specific tables to seed]:names:' \
                '(-c --count)'{-c,--count}'[Number of records per table]:n:' \
                '--clean[Clean tables before seeding]' \
                '(-s --strategy)'{-s,--strategy}'[Seeding strategy]:type:' \
                '--relationships[Create related records]' \
                '--locale[Faker locale]:locale:' \
                '--seed[Random seed for reproducibility]:number:' \
                '--custom[Custom seeder file]:file:_files' \
                '(-v --verbose)'{-v,--verbose}'[Verbose output]' \
                '--json[Output as JSON]' \
                '--config[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        setup)
            _arguments \
                '(-e --environment)'{-e,--environment}'[Test environment]:env:' \
                '(-d --database)'{-d,--database}'[Test database name]:name:' \
                '--clean[Clean existing test database]' \
                '(-f --force)'{-f,--force}'[Skip confirmation when dropping an existing database]' \
                '--migrate[Run migrations]' \
                '--seed[Run seeders]' \
                '--fixtures[Load specific fixtures]:files:_files' \
                '--parallel[Enable parallel test execution]' \
                '--isolation[Test isolation strategy]:type:' \
                '(-v --verbose)'{-v,--verbose}'[Verbose output]' \
                '--json[Output as JSON]' \
                '--config[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        teardown)
            _arguments \
                '(-e --environment)'{-e,--environment}'[Test environment to clean]:env:' \
                '(-d --database)'{-d,--database}'[Specific database to clean]:name:' \
                '(-f --force)'{-f,--force}'[Force cleanup without confirmation]' \
                '--keep-data[Keep test data (truncate instead of drop)]' \
                '--preserve-logs[Preserve test execution logs]' \
                '--clean-artifacts[Clean test artifacts]' \
                '--pattern[Database name pattern to match]:pattern:' \
                '(-v --verbose)'{-v,--verbose}'[Verbose output]' \
                '--json[Output as JSON]' \
                '--config[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
    esac
}

_kysera_plugin() {
    local -a subcmds
    subcmds=(
        'config:Configure plugin settings'
        'disable:Disable a plugin'
        'enable:Enable a plugin'
        'list:List available and installed plugins'
    )
    if (( CURRENT == 2 )); then
        _describe -t commands 'plugin subcommand' subcmds
        return
    fi
    case $words[2] in
        config)
            _arguments \
                '(-g --get)'{-g,--get}'[Get configuration value]:key:' \
                '(-s --set)'{-s,--set}'[Set configuration key]:key:' \
                '--value[Configuration value to set]:value:' \
                '--reset[Reset to default configuration]' \
                '--show[Show current configuration]' \
                '--edit[Edit configuration interactively]' \
                '--validate[Validate configuration]' \
                '--export[Export configuration to file]:file:_files' \
                '--import[Import configuration from file]:file:_files' \
                '--json[Output as JSON]' \
                '--config[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        disable)
            _arguments \
                '--all[Disable all enabled plugins]' \
                '(-f --force)'{-f,--force}'[Force disable without dependency checks]' \
                '--keep-config[Keep plugin configuration]' \
                '--restart[Restart application after disabling]' \
                '--json[Output as JSON]' \
                '--config[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        enable)
            _arguments \
                '--all[Enable all installed plugins]' \
                '(-f --force)'{-f,--force}'[Force enable without checks]' \
                '--configure[Configure plugin after enabling]' \
                '--restart[Restart application after enabling]' \
                '--json[Output as JSON]' \
                '--config[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        list)
            _arguments \
                '--installed[Show only installed plugins]' \
                '--available[Show available plugins from registry]' \
                '--enabled[Show only enabled plugins]' \
                '--disabled[Show only disabled plugins]' \
                '(-c --category)'{-c,--category}'[Filter by category]:type:' \
                '(-s --search)'{-s,--search}'[Search plugins by name or description]:query:' \
                '--show-details[Show detailed plugin information]' \
                '--json[Output as JSON]' \
                '--config[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
    esac
}

_kysera_schema() {
    local -a subcmds
    subcmds=(
        'clone:Clone a schema structure (and optionally data) to a new schema'
        'compare:Compare two schemas and show differences'
        'create:Create a new database schema'
        'drop:Drop a database schema'
        'info:Show detailed information about a schema'
        'list:List all database schemas'
    )
    if (( CURRENT == 2 )); then
        _describe -t commands 'schema subcommand' subcmds
        return
    fi
    case $words[2] in
        clone)
            _arguments \
                '--include-data[Include table data in the clone]' \
                '--exclude[Tables to exclude from cloning]:tables:' \
                '--tenant[Create target as tenant schema with specified ID]:id:' \
                '--force[Skip confirmation prompt]' \
                '(-v --verbose)'{-v,--verbose}'[Show detailed output]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        compare)
            _arguments \
                '--json[Output as JSON]' \
                '(-v --verbose)'{-v,--verbose}'[Show detailed output]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        create)
            _arguments \
                '--tenant[Create as tenant schema with specified ID]:id:' \
                '--if-not-exists[Do not error if schema already exists]' \
                '--force[Skip confirmation prompt]' \
                '(-v --verbose)'{-v,--verbose}'[Show detailed output]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        drop)
            _arguments \
                '--cascade[Drop all objects in the schema (CASCADE)]' \
                '--if-exists[Do not error if schema does not exist]' \
                '--force[Skip confirmation prompt]' \
                '(-v --verbose)'{-v,--verbose}'[Show detailed output]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        info)
            _arguments \
                '--json[Output as JSON]' \
                '--indexes[Show index information]' \
                '--foreign-keys[Show foreign key relationships]' \
                '(-v --verbose)'{-v,--verbose}'[Show all details]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
        list)
            _arguments \
                '--json[Output as JSON]' \
                '--tenant[Only show tenant schemas]' \
                '(-v --verbose)'{-v,--verbose}'[Show detailed information]' \
                '(-c --config)'{-c,--config}'[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"' \
                '(-h --help)'{-h,--help}'[Display help]'
            ;;
    esac
}

_kysera() {
    local -a commands
    commands=(
        'init:Initialize a new Kysera project'
        'migrate:Database migration management'
        'generate:Code generation utilities'
        'db:Database management utilities'
        'health:Database health monitoring'
        'audit:Audit logging and history'
        'debug:Debug and diagnostic utilities'
        'query:Query utilities and analysis'
        'repository:Repository pattern utilities'
        'test:Test environment management'
        'plugin:Plugin management'
        'schema:PostgreSQL schema management'
        'help:Display help for command'
    )

    local -a global_opts
    global_opts=(
        '--verbose[Enable verbose output]'
        '(-q --quiet)'{-q,--quiet}'[Suppress non-essential output]'
        '--dry-run[Preview changes without executing]'
        '--config[Path to configuration file]:config file:_files -g "*.{ts,mts,cts,js,mjs,cjs,json}"'
        '--no-color[Disable colored output]'
        '--json[Output results as JSON]'
        '--env[Environment (development/production/test)]:environment:(development production test)'
        '(-v --version)'{-v,--version}'[Show CLI version]'
        '(-h --help)'{-h,--help}'[Display help]'
    )

    _arguments -C \
        '1: :->cmds' \
        '*:: :->args' && return 0

    case $state in
        cmds)
            _describe -t commands 'kysera commands' commands
            _arguments $global_opts
            ;;
        args)
            case $words[1] in
                migrate)
                    _kysera_migrate
                    ;;
                generate|g)
                    _kysera_generate
                    ;;
                db)
                    _kysera_db
                    ;;
                health)
                    _kysera_health
                    ;;
                audit)
                    _kysera_audit
                    ;;
                debug)
                    _kysera_debug
                    ;;
                query)
                    _kysera_query
                    ;;
                repository)
                    _kysera_repository
                    ;;
                test)
                    _kysera_test
                    ;;
                plugin)
                    _kysera_plugin
                    ;;
                schema)
                    _kysera_schema
                    ;;
                init)
                    _arguments \
                        '1:project name:' \
                        '(-t --template)'{-t,--template}'[Project template (basic/api/graphql/monorepo)]:name:(basic api graphql monorepo)' \
                        '(-d --database)'{-d,--database}'[Database dialect (postgres/mysql/sqlite)]:dialect:(postgres mysql sqlite)' \
                        '(-p --plugins)'{-p,--plugins}'[Comma-separated list of plugins]:list:' \
                        '--package-manager[Package manager (npm/pnpm/yarn/bun)]:pm:(npm pnpm yarn bun)' \
                        '--typescript[Use TypeScript]' \
                        '--no-typescript[Use JavaScript]' \
                        '--git[Initialize git repository]' \
                        '--no-git[Skip git initialization]' \
                        '--install[Install dependencies]' \
                        '--no-install[Skip dependency installation]' \
                        '(-h --help)'{-h,--help}'[Display help]'
                    ;;
                help)
                    _describe -t commands 'kysera commands' commands
                    ;;
            esac
            ;;
    esac
}

_kysera "$@"
