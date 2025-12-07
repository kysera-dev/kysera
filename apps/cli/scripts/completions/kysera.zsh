#compdef kysera
# Zsh completion for kysera CLI
# Installation:
#   Copy this file to a directory in your $fpath (e.g., /usr/local/share/zsh/site-functions/_kysera)
#   Or add to your ~/.zshrc: fpath=(/path/to/completions $fpath) && autoload -U compinit && compinit

_kysera() {
    local -a commands
    commands=(
        'init:Initialize a new Kysera project'
        'migrate:Database migration management'
        'generate:Code generation utilities'
        'db:Database management tools'
        'health:Health monitoring and metrics'
        'audit:Audit logging and history'
        'debug:Debug and diagnostic tools'
        'query:Query analysis and utilities'
        'repository:Repository pattern utilities'
        'test:Test environment management'
        'plugin:Plugin management'
        'help:Show help information'
    )

    local -a global_opts
    global_opts=(
        '--help[Show help information]'
        '--version[Show version number]'
        '--verbose[Detailed output]'
        '--quiet[Minimal output]'
        '--dry-run[Preview without executing]'
        '--json[JSON output format]'
        '--config[Custom config file]:config file:_files -g "*.{ts,js,json}"'
        '--no-color[Disable colored output]'
    )

    _arguments -C \
        '1: :->cmds' \
        '*:: :->args' && return 0

    case $state in
        cmds)
            _describe -t commands 'kysera commands' commands
            ;;
        args)
            case $words[1] in
                init)
                    _arguments \
                        '1:project name:' \
                        '--dialect[Database dialect]:dialect:(postgres mysql sqlite)' \
                        '--typescript[Use TypeScript]' \
                        '--javascript[Use JavaScript]' \
                        '--with-examples[Include example files]' \
                        '--skip-git[Skip git initialization]' \
                        $global_opts
                    ;;
                migrate|m)
                    local -a migrate_cmds
                    migrate_cmds=(
                        'create:Create a new migration file'
                        'up:Run pending migrations'
                        'down:Rollback the last migration'
                        'status:Show migration status'
                        'list:List all migrations'
                        'reset:Reset all migrations'
                        'fresh:Drop all tables and re-run migrations'
                        'rollback:Rollback migrations'
                    )
                    _arguments \
                        '1: :_describe "migrate commands" migrate_cmds' \
                        '--name[Migration name]:name:' \
                        '--table[Table name]:table:' \
                        '--all[Apply to all migrations]' \
                        '--step[Number of migrations]:step:' \
                        '--to[Target migration]:migration:' \
                        $global_opts
                    ;;
                generate|g)
                    local -a generate_cmds
                    generate_cmds=(
                        'model:Generate a model class'
                        'repository:Generate a repository class'
                        'schema:Generate a schema definition'
                        'crud:Generate complete CRUD operations'
                        'migration:Generate a migration file'
                    )
                    _arguments \
                        '1: :_describe "generate commands" generate_cmds' \
                        '2:entity name:' \
                        '--table[Table name]:table:' \
                        '--output[Output directory]:directory:_files -/' \
                        '--with-validation[Include validation]' \
                        '--with-tests[Generate tests]' \
                        '--api[Generate API endpoints]' \
                        '--crud[Generate CRUD operations]' \
                        '--validation[Validation library]:library:(zod yup joi none)' \
                        $global_opts
                    ;;
                db)
                    local -a db_cmds
                    db_cmds=(
                        'seed:Seed the database'
                        'reset:Reset the database'
                        'tables:List all tables'
                        'dump:Dump database to file'
                        'restore:Restore database from dump'
                        'introspect:Introspect database schema'
                        'console:Open database console'
                    )
                    _arguments \
                        '1: :_describe "db commands" db_cmds' \
                        '--force[Force operation without confirmation]' \
                        '--output[Output file]:file:_files' \
                        '--format[Output format]:format:(sql json yaml)' \
                        '--env[Environment]:env:(development test production)' \
                        $global_opts
                    ;;
                health)
                    local -a health_cmds
                    health_cmds=(
                        'check:Check database health'
                        'watch:Watch health metrics'
                        'metrics:Show detailed metrics'
                    )
                    _arguments \
                        '1: :_describe "health commands" health_cmds' \
                        '--interval[Check interval in seconds]:interval:' \
                        '--format[Output format]:format:(table json)' \
                        '--threshold[Alert threshold]:threshold:' \
                        $global_opts
                    ;;
                audit)
                    local -a audit_cmds
                    audit_cmds=(
                        'logs:Show audit logs'
                        'history:Show entity history'
                        'restore:Restore entity state'
                        'stats:Show audit statistics'
                        'cleanup:Cleanup old audit logs'
                        'compare:Compare entity versions'
                        'diff:Show differences between versions'
                    )
                    _arguments \
                        '1: :_describe "audit commands" audit_cmds' \
                        '--from[Start date]:date:' \
                        '--to[End date]:date:' \
                        '--entity[Entity type]:entity:' \
                        '--limit[Result limit]:limit:' \
                        '--format[Output format]:format:(table json)' \
                        $global_opts
                    ;;
                debug)
                    local -a debug_cmds
                    debug_cmds=(
                        'connection:Test database connection'
                        'schema:Show schema information'
                        'queries:Show recent queries'
                        'slow-queries:Show slow queries'
                        'explain:Explain query execution'
                    )
                    _arguments \
                        '1: :_describe "debug commands" debug_cmds' \
                        $global_opts
                    ;;
                query)
                    local -a query_cmds
                    query_cmds=(
                        'analyze:Analyze query performance'
                        'explain:Explain query execution plan'
                        'optimize:Suggest query optimizations'
                        'index:Suggest index improvements'
                        'suggest:Suggest query improvements'
                    )
                    _arguments \
                        '1: :_describe "query commands" query_cmds' \
                        $global_opts
                    ;;
                repository)
                    local -a repo_cmds
                    repo_cmds=(
                        'list:List all repositories'
                        'create:Create a new repository'
                        'scaffold:Scaffold repository structure'
                        'validate:Validate repository implementation'
                        'test:Test repository operations'
                    )
                    _arguments \
                        '1: :_describe "repository commands" repo_cmds' \
                        $global_opts
                    ;;
                test)
                    local -a test_cmds
                    test_cmds=(
                        'setup:Setup test environment'
                        'teardown:Teardown test environment'
                        'seed:Seed test data'
                        'fixtures:Load test fixtures'
                        'run:Run tests'
                    )
                    _arguments \
                        '1: :_describe "test commands" test_cmds' \
                        '--env[Environment]:env:(development test production)' \
                        '--count[Number of records]:count:' \
                        '--strategy[Seeding strategy]:strategy:(realistic minimal random faker)' \
                        '--force[Force operation]' \
                        $global_opts
                    ;;
                plugin)
                    local -a plugin_cmds
                    plugin_cmds=(
                        'list:List installed plugins'
                        'install:Install a plugin'
                        'uninstall:Uninstall a plugin'
                        'enable:Enable a plugin'
                        'disable:Disable a plugin'
                        'info:Show plugin information'
                    )
                    _arguments \
                        '1: :_describe "plugin commands" plugin_cmds' \
                        '2:plugin name:' \
                        '--global[Install globally]' \
                        '--save[Save to config]' \
                        $global_opts
                    ;;
                help)
                    _describe -t commands 'kysera commands' commands
                    ;;
            esac
            ;;
    esac
}

_kysera "$@"
