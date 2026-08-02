# Fish completion for kysera CLI
# Generated from the CLI command tree by generate.mjs - do not edit by hand.
# Installation:
#   Copy this file to ~/.config/fish/completions/kysera.fish
#   Or copy to /usr/share/fish/vendor_completions.d/kysera.fish (system-wide)

# Remove any existing completions
complete -c kysera -e

# Global options (accepted before a command)
complete -c kysera -n "__fish_use_subcommand" -l verbose -d "Enable verbose output"
complete -c kysera -n "__fish_use_subcommand" -s q -l quiet -d "Suppress non-essential output"
complete -c kysera -n "__fish_use_subcommand" -l dry-run -d "Preview changes without executing"
complete -c kysera -n "__fish_use_subcommand" -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_use_subcommand" -l no-color -d "Disable colored output"
complete -c kysera -n "__fish_use_subcommand" -l json -d "Output results as JSON"
complete -c kysera -n "__fish_use_subcommand" -l env -x -a "development production test" -d "Environment (development/production/test)"
complete -c kysera -n "__fish_use_subcommand" -s v -l version -d "Show CLI version"
complete -c kysera -n "__fish_use_subcommand" -s h -l help -d "Display help"

# Main commands
complete -c kysera -f -n "__fish_use_subcommand" -a init -d "Initialize a new Kysera project"
complete -c kysera -f -n "__fish_use_subcommand" -a doctor -d "Diagnose environment, configuration and database health"
complete -c kysera -f -n "__fish_use_subcommand" -a migrate -d "Database migration management"
complete -c kysera -f -n "__fish_use_subcommand" -a generate -d "Code generation utilities"
complete -c kysera -f -n "__fish_use_subcommand" -a db -d "Database management utilities"
complete -c kysera -f -n "__fish_use_subcommand" -a health -d "Database health monitoring"
complete -c kysera -f -n "__fish_use_subcommand" -a audit -d "Audit logging and history"
complete -c kysera -f -n "__fish_use_subcommand" -a debug -d "Debug and diagnostic utilities"
complete -c kysera -f -n "__fish_use_subcommand" -a query -d "Query utilities and analysis"
complete -c kysera -f -n "__fish_use_subcommand" -a repository -d "Repository pattern utilities"
complete -c kysera -f -n "__fish_use_subcommand" -a test -d "Test environment management"
complete -c kysera -f -n "__fish_use_subcommand" -a plugin -d "Plugin management"
complete -c kysera -f -n "__fish_use_subcommand" -a schema -d "PostgreSQL schema management"
complete -c kysera -f -n "__fish_use_subcommand" -a rls -d "Row-Level Security utilities"
complete -c kysera -f -n "__fish_use_subcommand" -a help -d "Display help for command"
complete -c kysera -f -n "__fish_use_subcommand" -a g -d "Code generation utilities (alias for generate)"

# migrate subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from migrate; and not __fish_seen_subcommand_from baseline create down list reset fresh status up verify" -a baseline -d "Mark migrations as executed without running them (adopt an existing schema)"
complete -c kysera -f -n "__fish_seen_subcommand_from migrate; and not __fish_seen_subcommand_from baseline create down list reset fresh status up verify" -a create -d "Create a new migration file"
complete -c kysera -f -n "__fish_seen_subcommand_from migrate; and not __fish_seen_subcommand_from baseline create down list reset fresh status up verify" -a down -d "Rollback migrations"
complete -c kysera -f -n "__fish_seen_subcommand_from migrate; and not __fish_seen_subcommand_from baseline create down list reset fresh status up verify" -a list -d "List all migrations"
complete -c kysera -f -n "__fish_seen_subcommand_from migrate; and not __fish_seen_subcommand_from baseline create down list reset fresh status up verify" -a reset -d "Rollback all migrations (dangerous!)"
complete -c kysera -f -n "__fish_seen_subcommand_from migrate; and not __fish_seen_subcommand_from baseline create down list reset fresh status up verify" -a fresh -d "Drop all tables and re-run migrations"
complete -c kysera -f -n "__fish_seen_subcommand_from migrate; and not __fish_seen_subcommand_from baseline create down list reset fresh status up verify" -a status -d "Show migration status"
complete -c kysera -f -n "__fish_seen_subcommand_from migrate; and not __fish_seen_subcommand_from baseline create down list reset fresh status up verify" -a up -d "Run pending migrations"
complete -c kysera -f -n "__fish_seen_subcommand_from migrate; and not __fish_seen_subcommand_from baseline create down list reset fresh status up verify" -a verify -d "Verify executed migrations match the files on disk (checksum drift check)"

# migrate baseline options
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from baseline" -l all -d "Baseline every pending migration"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from baseline" -s v -l verbose -d "Show detailed output"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from baseline" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from baseline" -l json -d "Output results as JSON"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from baseline" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# migrate create options
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from create" -s d -l dir -r -F -d "Migration directory"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from create" -l directory -r -F -d "Migration directory (alias for --dir)"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from create" -s t -l template -x -d "Migration template"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from create" -l ts -d "Generate TypeScript file"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from create" -l no-ts -d "Generate JavaScript file"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from create" -l table -x -d "Table name for table-based templates"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from create" -l columns -x -d "Comma-separated column definitions (name:type:nullable:default)"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from create" -l json -d "Output results as JSON"

# migrate down options
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from down" -l steps -x -d "Number of migrations to rollback"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from down" -s t -l to -x -d "Rollback everything after the given migration"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from down" -l all -d "Rollback all migrations"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from down" -l dry-run -d "Show the rollback plan without touching the database"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from down" -s v -l verbose -d "Show detailed output"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from down" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from down" -l force -d "Skip confirmation prompt"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from down" -l json -d "Output results as JSON"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from down" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# migrate list options
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from list" -l pending -d "Show only pending migrations"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from list" -l executed -d "Show only executed migrations"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from list" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from list" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from list" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# migrate reset options
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from reset" -l force -d "Skip confirmation prompt"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from reset" -l run -d "Re-run migrations after reset"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from reset" -l seed -d "Run seeds after reset"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from reset" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from reset" -s v -l verbose -d "Show detailed output"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from reset" -l json -d "Output results as JSON"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from reset" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# migrate fresh options
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from fresh" -l seed -d "Run seeds after migration"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from fresh" -l force -d "Skip confirmation prompt"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from fresh" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from fresh" -s v -l verbose -d "Show detailed output"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from fresh" -l json -d "Output results as JSON"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from fresh" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# migrate status options
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from status" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from status" -s v -l verbose -d "Show detailed information"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from status" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from status" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# migrate up options
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from up" -s t -l to -x -d "Migrate up to a specific migration (inclusive)"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from up" -l steps -x -d "Number of migrations to run"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from up" -l count -x -d "Number of migrations to run (alias for --steps)"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from up" -l dry-run -d "Show the execution plan without touching the database"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from up" -s v -l verbose -d "Show detailed output"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from up" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from up" -l json -d "Output results as JSON"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from up" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# migrate verify options
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from verify" -l update -d "Store current file checksums for executed records that have none"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from verify" -s v -l verbose -d "Show detailed output"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from verify" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from verify" -l json -d "Output results as JSON"
complete -c kysera -n "__fish_seen_subcommand_from migrate; and __fish_seen_subcommand_from verify" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# generate subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from generate g; and not __fish_seen_subcommand_from crud database model repository schema" -a crud -d "Generate complete CRUD stack (model, repository, schema) for a table"
complete -c kysera -f -n "__fish_seen_subcommand_from generate g; and not __fish_seen_subcommand_from crud database model repository schema" -a database -d ""
complete -c kysera -f -n "__fish_seen_subcommand_from generate g; and not __fish_seen_subcommand_from crud database model repository schema" -a model -d "Generate TypeScript model from database table"
complete -c kysera -f -n "__fish_seen_subcommand_from generate g; and not __fish_seen_subcommand_from crud database model repository schema" -a repository -d "Generate repository from database table"
complete -c kysera -f -n "__fish_seen_subcommand_from generate g; and not __fish_seen_subcommand_from crud database model repository schema" -a schema -d "Generate Zod schema from database table"

# generate crud options
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from crud" -s o -l output-dir -r -F -d "Base output directory"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from crud" -l overwrite -d "Overwrite existing files"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from crud" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from crud" -l with-validation -d "Include Zod validation"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from crud" -l no-with-validation -d "Skip Zod validation"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from crud" -l with-pagination -d "Include pagination methods"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from crud" -l no-with-pagination -d "Skip pagination methods"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from crud" -l with-soft-delete -d "Include soft delete support"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from crud" -l with-timestamps -d "Include timestamp support"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from crud" -l no-with-timestamps -d "Skip timestamp support"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from crud" -l format -d "Format generated files with Prettier"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from crud" -l no-format -d "Skip formatting"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from crud" -l json -d "Output results as JSON"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from crud" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# generate database options
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from database" -s o -l output -r -F -d "Output file"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from database" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from database" -s s -l schema -x -d "PostgreSQL schema name (default: public)"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from database" -l exclude -x -d "Comma-separated table globs to exclude (wins over include)"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from database" -l with-helpers -d "Emit Selectable/Insertable/Updateable aliases per table"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from database" -l json -d "Output a {file, tables, written} summary as JSON (one line per --watch run)"

# generate model options
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from model" -s o -l output -r -F -d "Output directory"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from model" -l overwrite -d "Overwrite existing files"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from model" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from model" -l timestamps -d "Include timestamp fields"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from model" -l no-timestamps -d "Exclude timestamp fields"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from model" -l soft-delete -d "Include soft delete fields"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from model" -l json -d "Output results as JSON"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from model" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# generate repository options
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from repository" -s o -l output -r -F -d "Output directory"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from repository" -l overwrite -d "Overwrite existing files"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from repository" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from repository" -l with-validation -d "Include Zod validation"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from repository" -l no-with-validation -d "Skip Zod validation"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from repository" -l with-pagination -d "Include pagination methods"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from repository" -l no-with-pagination -d "Skip pagination methods"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from repository" -l with-soft-delete -d "Include soft delete support"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from repository" -l with-timestamps -d "Include timestamp support"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from repository" -l no-with-timestamps -d "Skip timestamp support"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from repository" -l json -d "Output results as JSON"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from repository" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# generate schema options
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from schema" -s o -l output -r -F -d "Output directory"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from schema" -l overwrite -d "Overwrite existing files"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from schema" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from schema" -l strict -d "Use strict validation (no unknown keys)"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from schema" -l no-strict -d "Allow unknown keys in validation"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from schema" -l json -d "Output results as JSON"
complete -c kysera -n "__fish_seen_subcommand_from generate g; and __fish_seen_subcommand_from schema" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# db subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from db; and not __fish_seen_subcommand_from console dump introspect reset restore seed tables" -a console -d "Open interactive database console"
complete -c kysera -f -n "__fish_seen_subcommand_from db; and not __fish_seen_subcommand_from console dump introspect reset restore seed tables" -a dump -d "Export database dump"
complete -c kysera -f -n "__fish_seen_subcommand_from db; and not __fish_seen_subcommand_from console dump introspect reset restore seed tables" -a introspect -d "Introspect database schema"
complete -c kysera -f -n "__fish_seen_subcommand_from db; and not __fish_seen_subcommand_from console dump introspect reset restore seed tables" -a reset -d "Reset database (drop all tables and re-run migrations)"
complete -c kysera -f -n "__fish_seen_subcommand_from db; and not __fish_seen_subcommand_from console dump introspect reset restore seed tables" -a restore -d "Restore database from dump"
complete -c kysera -f -n "__fish_seen_subcommand_from db; and not __fish_seen_subcommand_from console dump introspect reset restore seed tables" -a seed -d "Run database seeders"
complete -c kysera -f -n "__fish_seen_subcommand_from db; and not __fish_seen_subcommand_from console dump introspect reset restore seed tables" -a tables -d "List all database tables with statistics"

# db console options
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from console" -s e -l execute -x -d "Execute SQL query and exit"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from console" -l force -d "Skip confirmation for destructive queries"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from console" -s c -l config -r -F -d "Path to configuration file"

# db dump options
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from dump" -s o -l output -r -F -d "Output file path"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from dump" -s t -l tables -x -d "Comma-separated table names"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from dump" -l data-only -d "Export data only (no schema)"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from dump" -l schema-only -d "Export schema only (no data)"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from dump" -s f -l format -x -a "sql json" -d "Format (sql/json)"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from dump" -l json -d "Output dump summary as JSON"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from dump" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from dump" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# db introspect options
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from introspect" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from introspect" -l detailed -d "Show detailed information"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from introspect" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from introspect" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# db reset options
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from reset" -l force -d "Skip confirmation prompt"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from reset" -l seed -d "Run seeds after reset"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from reset" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from reset" -s v -l verbose -d "Show detailed output"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from reset" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# db restore options
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from restore" -l force -d "Skip confirmation prompt"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from restore" -s c -l config -r -F -d "Path to configuration file"

# db seed options
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from seed" -s f -l file -r -F -d "Specific seed file to run"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from seed" -s d -l directory -r -F -d "Seed files directory"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from seed" -l fresh -d "Truncate tables before seeding"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from seed" -l dry-run -d "Show what would be executed without making changes"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from seed" -l transaction -d "Run all seeds in a single transaction"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from seed" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from seed" -s v -l verbose -d "Show detailed output"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from seed" -l json -d "Output results as JSON"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from seed" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# db tables options
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from tables" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from tables" -s v -l verbose -d "Show detailed info (columns, indexes, etc.)"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from tables" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from db; and __fish_seen_subcommand_from tables" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# health subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from health; and not __fish_seen_subcommand_from check metrics watch" -a check -d "Perform a health check"
complete -c kysera -f -n "__fish_seen_subcommand_from health; and not __fish_seen_subcommand_from check metrics watch" -a metrics -d "Show detailed database metrics"
complete -c kysera -f -n "__fish_seen_subcommand_from health; and not __fish_seen_subcommand_from check metrics watch" -a watch -d "Continuous health monitoring"

# health check options
complete -c kysera -n "__fish_seen_subcommand_from health; and __fish_seen_subcommand_from check" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from health; and __fish_seen_subcommand_from check" -l watch -d "Watch mode (continuous monitoring)"
complete -c kysera -n "__fish_seen_subcommand_from health; and __fish_seen_subcommand_from check" -l interval -x -d "Check interval in ms"
complete -c kysera -n "__fish_seen_subcommand_from health; and __fish_seen_subcommand_from check" -s v -l verbose -d "Show detailed metrics"
complete -c kysera -n "__fish_seen_subcommand_from health; and __fish_seen_subcommand_from check" -s c -l config -r -F -d "Path to configuration file"

# health metrics options
complete -c kysera -n "__fish_seen_subcommand_from health; and __fish_seen_subcommand_from metrics" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from health; and __fish_seen_subcommand_from metrics" -l period -x -d "Time period (1h, 24h, 7d)"
complete -c kysera -n "__fish_seen_subcommand_from health; and __fish_seen_subcommand_from metrics" -s c -l config -r -F -d "Path to configuration file"

# health watch options
complete -c kysera -n "__fish_seen_subcommand_from health; and __fish_seen_subcommand_from watch" -l interval -x -d "Check interval in ms"
complete -c kysera -n "__fish_seen_subcommand_from health; and __fish_seen_subcommand_from watch" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from health; and __fish_seen_subcommand_from watch" -l log -r -F -d "Log to file"
complete -c kysera -n "__fish_seen_subcommand_from health; and __fish_seen_subcommand_from watch" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from health; and __fish_seen_subcommand_from watch" -s v -l verbose -d "Show detailed metrics"

# audit subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from audit; and not __fish_seen_subcommand_from cleanup compare diff history init logs restore stats" -a cleanup -d "Clean up old audit logs"
complete -c kysera -f -n "__fish_seen_subcommand_from audit; and not __fish_seen_subcommand_from cleanup compare diff history init logs restore stats" -a compare -d "Compare two audit log entries"
complete -c kysera -f -n "__fish_seen_subcommand_from audit; and not __fish_seen_subcommand_from cleanup compare diff history init logs restore stats" -a diff -d "Show entity diff between audit entries"
complete -c kysera -f -n "__fish_seen_subcommand_from audit; and not __fish_seen_subcommand_from cleanup compare diff history init logs restore stats" -a history -d "Show entity history timeline"
complete -c kysera -f -n "__fish_seen_subcommand_from audit; and not __fish_seen_subcommand_from cleanup compare diff history init logs restore stats" -a init -d "Generate a migration that creates the audit log table"
complete -c kysera -f -n "__fish_seen_subcommand_from audit; and not __fish_seen_subcommand_from cleanup compare diff history init logs restore stats" -a logs -d "Query audit logs with filters"
complete -c kysera -f -n "__fish_seen_subcommand_from audit; and not __fish_seen_subcommand_from cleanup compare diff history init logs restore stats" -a restore -d "Restore entity from audit log"
complete -c kysera -f -n "__fish_seen_subcommand_from audit; and not __fish_seen_subcommand_from cleanup compare diff history init logs restore stats" -a stats -d "Show audit statistics"

# audit cleanup options
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from cleanup" -l older-than -x -d "Delete logs older than duration (30d, 3m, 1y)"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from cleanup" -s t -l table -x -d "Clean specific table only"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from cleanup" -l dry-run -d "Preview cleanup without deleting"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from cleanup" -l force -d "Skip confirmation prompt"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from cleanup" -l batch-size -x -d "Delete in batches"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from cleanup" -s c -l config -r -F -d "Path to configuration file"

# audit compare options
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from compare" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from compare" -l show-values -d "Show full field values"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from compare" -s c -l config -r -F -d "Path to configuration file"

# audit diff options
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from diff" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from diff" -s u -l unified -d "Show unified diff format"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from diff" -l no-color -d "Disable colored output"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from diff" -s c -l config -r -F -d "Path to configuration file"

# audit history options
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from history" -s l -l limit -x -d "Limit number of results"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from history" -l show-values -d "Show changed values"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from history" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from history" -l reverse -d "Show oldest first (default: newest first)"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from history" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from history" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# audit init options
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from init" -l table -x -d ""
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from init" -l dialect-ddl -d ""
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from init" -s d -l dir -r -F -d "Migrations directory (default: from configuration)"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from init" -s c -l config -r -F -d "Path to configuration file"

# audit logs options
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from logs" -s t -l table -x -d "Filter by table name"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from logs" -s u -l user -x -d "Filter by user ID"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from logs" -s a -l action -x -a "INSERT UPDATE DELETE" -d "Filter by action (INSERT/UPDATE/DELETE)"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from logs" -s l -l limit -x -d "Limit number of results"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from logs" -l since -x -d "Show logs since datetime (ISO 8601)"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from logs" -l until -x -d "Show logs until datetime (ISO 8601)"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from logs" -s e -l entity-id -x -d "Filter by entity ID"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from logs" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from logs" -s v -l verbose -d "Show detailed information including changes"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from logs" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from logs" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# audit restore options
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from restore" -l dry-run -d "Preview restore without executing"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from restore" -l force -d "Skip confirmation prompt"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from restore" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from restore" -s c -l config -r -F -d "Path to configuration file"

# audit stats options
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from stats" -s t -l table -x -d "Filter by table name"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from stats" -s u -l user -x -d "Filter by user ID"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from stats" -s p -l period -x -d "Time period (1h, 1d, 1w, 1m)"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from stats" -s f -l format -x -a "table json chart" -d "Output format (table/json/chart)"
complete -c kysera -n "__fish_seen_subcommand_from audit; and __fish_seen_subcommand_from stats" -s c -l config -r -F -d "Path to configuration file"

# debug subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from debug; and not __fish_seen_subcommand_from analyzer circuit-breaker errors profile sql" -a analyzer -d "Query analyzer with optimization suggestions"
complete -c kysera -f -n "__fish_seen_subcommand_from debug; and not __fish_seen_subcommand_from analyzer circuit-breaker errors profile sql" -a circuit-breaker -d "Circuit breaker monitoring and management"
complete -c kysera -f -n "__fish_seen_subcommand_from debug; and not __fish_seen_subcommand_from analyzer circuit-breaker errors profile sql" -a errors -d "Error analysis and pattern detection"
complete -c kysera -f -n "__fish_seen_subcommand_from debug; and not __fish_seen_subcommand_from analyzer circuit-breaker errors profile sql" -a profile -d "Query profiling and performance analysis"
complete -c kysera -f -n "__fish_seen_subcommand_from debug; and not __fish_seen_subcommand_from analyzer circuit-breaker errors profile sql" -a sql -d "Real-time SQL query monitoring and debugging"

# debug analyzer options
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from analyzer" -s q -l query -x -d "SQL query to analyze"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from analyzer" -s t -l table -x -d "Analyze queries for specific table"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from analyzer" -s e -l explain -d "Show execution plan"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from analyzer" -s s -l suggestions -d "Show optimization suggestions"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from analyzer" -s i -l indexes -d "Analyze index usage"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from analyzer" -l statistics -d "Show table statistics"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from analyzer" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from analyzer" -s c -l config -r -F -d "Path to configuration file"

# debug circuit-breaker options
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from circuit-breaker" -s a -l action -x -a "status reset open close" -d "Action to perform (status/reset/open/close)"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from circuit-breaker" -s s -l service -x -a "database cache api" -d "Service name (database/cache/api)"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from circuit-breaker" -s t -l threshold -x -d "Error threshold for opening circuit"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from circuit-breaker" -l timeout -x -d "Reset timeout in milliseconds"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from circuit-breaker" -s w -l watch -d "Watch mode - monitor in real-time"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from circuit-breaker" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from circuit-breaker" -s c -l config -r -F -d "Path to configuration file"

# debug errors options
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from errors" -s s -l since -x -d "Show errors since datetime (ISO 8601)"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from errors" -l until -x -d "Show errors until datetime (ISO 8601)"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from errors" -s l -l limit -x -d "Limit number of results"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from errors" -s p -l pattern -x -d "Filter errors by pattern"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from errors" -s g -l group-by -x -a "error table operation user" -d "Group errors by field (error/table/operation/user)"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from errors" -l show-queries -d "Show failing queries"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from errors" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from errors" -s c -l config -r -F -d "Path to configuration file"

# debug profile options
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from profile" -s q -l query -x -d "SQL query to profile"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from profile" -s t -l table -x -d "Profile queries on specific table"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from profile" -s o -l operation -x -a "select insert update delete" -d "Operation type (select/insert/update/delete)"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from profile" -s i -l iterations -x -d "Number of iterations"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from profile" -s w -l warmup -x -d "Number of warmup runs"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from profile" -l show-plan -d "Show query execution plan"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from profile" -l compare -x -d "Compare with another query"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from profile" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from profile" -s c -l config -r -F -d "Path to configuration file"

# debug sql options
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from sql" -s w -l watch -d "Watch mode - monitor queries in real-time"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from sql" -s f -l filter -x -d "Filter queries by pattern (regex)"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from sql" -s h -l highlight -x -d "Highlight specific keywords"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from sql" -l show-params -d "Show query parameters"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from sql" -l show-duration -d "Show query execution time"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from sql" -s l -l limit -x -d "Limit number of queries to show"
complete -c kysera -n "__fish_seen_subcommand_from debug; and __fish_seen_subcommand_from sql" -s c -l config -r -F -d "Path to configuration file"

# query subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from query; and not __fish_seen_subcommand_from analyze by-timestamp explain soft-deleted" -a analyze -d "Analyze query performance and provide optimization suggestions"
complete -c kysera -f -n "__fish_seen_subcommand_from query; and not __fish_seen_subcommand_from analyze by-timestamp explain soft-deleted" -a by-timestamp -d "Query records by timestamp"
complete -c kysera -f -n "__fish_seen_subcommand_from query; and not __fish_seen_subcommand_from analyze by-timestamp explain soft-deleted" -a explain -d "Show and analyze query execution plans"
complete -c kysera -f -n "__fish_seen_subcommand_from query; and not __fish_seen_subcommand_from analyze by-timestamp explain soft-deleted" -a soft-deleted -d "Query and manage soft-deleted records"

# query analyze options
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from analyze" -s q -l query -x -d "SQL query to analyze"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from analyze" -s f -l file -r -F -d "Read query from file"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from analyze" -l format -x -a "simple detailed json" -d "Output format (simple/detailed/json)"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from analyze" -s i -l show-indexes -d "Show index usage information"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from analyze" -s s -l show-statistics -d "Show table statistics"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from analyze" -l suggestions -d "Show optimization suggestions"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from analyze" -s b -l benchmark -x -d "Benchmark query N times"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from analyze" -l json -d "Output results as JSON (same as --format json)"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from analyze" -s c -l config -r -F -d "Path to configuration file"

# query by-timestamp options
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from by-timestamp" -s t -l table -x -d "Table name to query"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from by-timestamp" -s c -l column -x -d "Timestamp column name"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from by-timestamp" -l from -x -d "Start date (ISO format)"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from by-timestamp" -l to -x -d "End date (ISO format)"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from by-timestamp" -l last -x -d "Last N hours/days/weeks (e.g., 24h, 7d, 2w)"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from by-timestamp" -l order -x -a "asc desc" -d "Sort order (asc/desc)"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from by-timestamp" -s l -l limit -x -d "Limit results"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from by-timestamp" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from by-timestamp" -l config -r -F -d "Path to configuration file"

# query explain options
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from explain" -s q -l query -x -d "SQL query to explain"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from explain" -s f -l file -r -F -d "Read query from file"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from explain" -s a -l analyze -d "Execute query and show actual times"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from explain" -s v -l verbose -d "Show verbose output"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from explain" -l format -x -a "text json tree yaml" -d "Output format (text/json/tree/yaml)"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from explain" -l buffers -d "Show buffer usage (PostgreSQL)"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from explain" -l costs -d "Show cost estimates"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from explain" -l timing -d "Show timing information"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from explain" -l summary -d "Show summary at the end"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from explain" -l json -d "Output results as JSON (same as --format json)"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from explain" -s c -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from explain" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# query soft-deleted options
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from soft-deleted" -s t -l table -x -d "Table name to query"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from soft-deleted" -s c -l column -x -d "Soft delete column name"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from soft-deleted" -s r -l restore -x -d "Restore a soft-deleted record by ID"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from soft-deleted" -l purge -d "Permanently delete soft-deleted records"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from soft-deleted" -l force -d "Skip confirmation for purge"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from soft-deleted" -s l -l limit -x -d "Limit results"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from soft-deleted" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from soft-deleted" -l config -r -F -d "Path to configuration file"
complete -c kysera -n "__fish_seen_subcommand_from query; and __fish_seen_subcommand_from soft-deleted" -s s -l schema -x -d "PostgreSQL schema name (default: public)"

# repository subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from repository; and not __fish_seen_subcommand_from inspect list methods validate" -a inspect -d "Inspect a repository class in detail"
complete -c kysera -f -n "__fish_seen_subcommand_from repository; and not __fish_seen_subcommand_from inspect list methods validate" -a list -d "List all repository classes in the project"
complete -c kysera -f -n "__fish_seen_subcommand_from repository; and not __fish_seen_subcommand_from inspect list methods validate" -a methods -d "Show available methods in repository classes"
complete -c kysera -f -n "__fish_seen_subcommand_from repository; and not __fish_seen_subcommand_from inspect list methods validate" -a validate -d "Validate repository schemas against database"

# repository inspect options
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from inspect" -s f -l file -r -F -d "Repository file to inspect"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from inspect" -s c -l className -x -d "Repository class name"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from inspect" -l show-ast -d "Show abstract syntax tree"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from inspect" -l show-dependencies -d "Show dependencies graph"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from inspect" -l show-complexity -d "Show complexity metrics"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from inspect" -l show-database -d "Show database table info"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from inspect" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from inspect" -l config -r -F -d "Path to configuration file"

# repository list options
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from list" -s d -l directory -r -F -d "Directory to scan"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from list" -s p -l pattern -x -d "File pattern to match"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from list" -l show-methods -d "Show repository methods"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from list" -l show-schemas -d "Show entity schemas"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from list" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from list" -l config -r -F -d "Path to configuration file"

# repository methods options
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from methods" -s r -l repository -x -d "Repository class name"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from methods" -s f -l file -r -F -d "Repository file path"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from methods" -s g -l group-by -x -a "visibility type category" -d "Group methods by (visibility/type/category)"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from methods" -l filter -x -d "Filter methods by name pattern"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from methods" -l show-signatures -d "Show full method signatures"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from methods" -l show-examples -d "Show usage examples"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from methods" -l show-complexity -d "Show complexity metrics"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from methods" -l markdown -d "Output as markdown documentation"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from methods" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from methods" -l config -r -F -d "Path to configuration file"

# repository validate options
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from validate" -s d -l directory -r -F -d "Directory to scan"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from validate" -s p -l pattern -x -d "File pattern to match"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from validate" -l fix -d "Attempt to fix issues"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from validate" -l strict -d "Enable strict validation"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from validate" -l show-details -d "Show detailed validation results"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from validate" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from repository; and __fish_seen_subcommand_from validate" -l config -r -F -d "Path to configuration file"

# test subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from test; and not __fish_seen_subcommand_from fixtures seed setup teardown" -a fixtures -d "Load and manage test fixtures"
complete -c kysera -f -n "__fish_seen_subcommand_from test; and not __fish_seen_subcommand_from fixtures seed setup teardown" -a seed -d "Seed test database with sample data"
complete -c kysera -f -n "__fish_seen_subcommand_from test; and not __fish_seen_subcommand_from fixtures seed setup teardown" -a setup -d "Set up test database and environment"
complete -c kysera -f -n "__fish_seen_subcommand_from test; and not __fish_seen_subcommand_from fixtures seed setup teardown" -a teardown -d "Clean up test databases and artifacts"

# test fixtures options
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from fixtures" -s l -l load -r -F -d "Load specific fixture files"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from fixtures" -s d -l directory -r -F -d "Fixtures directory"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from fixtures" -s f -l format -x -d "Fixture format"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from fixtures" -s s -l save -x -d "Save current data as fixture"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from fixtures" -l list -d "List available fixtures"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from fixtures" -l validate -d "Validate fixtures without loading"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from fixtures" -l dependencies -d "Load fixture dependencies"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from fixtures" -l checksum -d "Verify fixture checksums"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from fixtures" -l tags -x -d "Filter by tags"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from fixtures" -s v -l verbose -d "Verbose output"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from fixtures" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from fixtures" -l config -r -F -d "Path to configuration file"

# test seed options
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from seed" -s t -l tables -x -d "Specific tables to seed"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from seed" -s c -l count -x -d "Number of records per table"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from seed" -l clean -d "Clean tables before seeding"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from seed" -s s -l strategy -x -d "Seeding strategy"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from seed" -l relationships -d "Create related records"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from seed" -l locale -x -d "Faker locale"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from seed" -l seed -x -d "Random seed for reproducibility"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from seed" -l custom -r -F -d "Custom seeder file"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from seed" -s v -l verbose -d "Verbose output"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from seed" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from seed" -l config -r -F -d "Path to configuration file"

# test setup options
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from setup" -s e -l environment -x -d "Test environment"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from setup" -s d -l database -x -d "Test database name"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from setup" -l clean -d "Clean existing test database"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from setup" -s f -l force -d "Skip confirmation when dropping an existing database"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from setup" -l migrate -d "Run migrations"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from setup" -l seed -d "Run seeders"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from setup" -l fixtures -r -F -d "Load specific fixtures"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from setup" -l parallel -d "Enable parallel test execution"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from setup" -l isolation -x -d "Test isolation strategy"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from setup" -s v -l verbose -d "Verbose output"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from setup" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from setup" -l config -r -F -d "Path to configuration file"

# test teardown options
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from teardown" -s e -l environment -x -d "Test environment to clean"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from teardown" -s d -l database -x -d "Specific database to clean"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from teardown" -s f -l force -d "Force cleanup without confirmation"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from teardown" -l keep-data -d "Keep test data (truncate instead of drop)"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from teardown" -l preserve-logs -d "Preserve test execution logs"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from teardown" -l clean-artifacts -d "Clean test artifacts"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from teardown" -l pattern -x -d "Database name pattern to match"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from teardown" -s v -l verbose -d "Verbose output"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from teardown" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from test; and __fish_seen_subcommand_from teardown" -l config -r -F -d "Path to configuration file"

# plugin subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from plugin; and not __fish_seen_subcommand_from config disable enable list" -a config -d "Configure plugin settings"
complete -c kysera -f -n "__fish_seen_subcommand_from plugin; and not __fish_seen_subcommand_from config disable enable list" -a disable -d "Disable a plugin"
complete -c kysera -f -n "__fish_seen_subcommand_from plugin; and not __fish_seen_subcommand_from config disable enable list" -a enable -d "Enable a plugin"
complete -c kysera -f -n "__fish_seen_subcommand_from plugin; and not __fish_seen_subcommand_from config disable enable list" -a list -d "List available and installed plugins"

# plugin config options
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from config" -s g -l get -x -d "Get configuration value"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from config" -s s -l set -x -d "Set configuration key"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from config" -l value -x -d "Configuration value to set"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from config" -l reset -d "Reset to default configuration"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from config" -l show -d "Show current configuration"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from config" -l edit -d "Edit configuration interactively"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from config" -l validate -d "Validate configuration"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from config" -l export -r -F -d "Export configuration to file"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from config" -l import -r -F -d "Import configuration from file"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from config" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from config" -l config -r -F -d "Path to configuration file"

# plugin disable options
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from disable" -l all -d "Disable all enabled plugins"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from disable" -s f -l force -d "Force disable without dependency checks"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from disable" -l keep-config -d "Keep plugin configuration"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from disable" -l restart -d "Restart application after disabling"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from disable" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from disable" -l config -r -F -d "Path to configuration file"

# plugin enable options
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from enable" -l all -d "Enable all installed plugins"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from enable" -s f -l force -d "Force enable without checks"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from enable" -l configure -d "Configure plugin after enabling"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from enable" -l restart -d "Restart application after enabling"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from enable" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from enable" -l config -r -F -d "Path to configuration file"

# plugin list options
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from list" -l installed -d "Show only installed plugins"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from list" -l available -d "Show available plugins from registry"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from list" -l enabled -d "Show only enabled plugins"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from list" -l disabled -d "Show only disabled plugins"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from list" -s c -l category -x -d "Filter by category"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from list" -s s -l search -x -d "Search plugins by name or description"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from list" -l show-details -d "Show detailed plugin information"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from list" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from plugin; and __fish_seen_subcommand_from list" -l config -r -F -d "Path to configuration file"

# schema subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from schema; and not __fish_seen_subcommand_from clone compare create drop info list" -a clone -d "Clone a schema structure (and optionally data) to a new schema"
complete -c kysera -f -n "__fish_seen_subcommand_from schema; and not __fish_seen_subcommand_from clone compare create drop info list" -a compare -d "Compare two schemas and show differences"
complete -c kysera -f -n "__fish_seen_subcommand_from schema; and not __fish_seen_subcommand_from clone compare create drop info list" -a create -d "Create a new database schema"
complete -c kysera -f -n "__fish_seen_subcommand_from schema; and not __fish_seen_subcommand_from clone compare create drop info list" -a drop -d "Drop a database schema"
complete -c kysera -f -n "__fish_seen_subcommand_from schema; and not __fish_seen_subcommand_from clone compare create drop info list" -a info -d "Show detailed information about a schema"
complete -c kysera -f -n "__fish_seen_subcommand_from schema; and not __fish_seen_subcommand_from clone compare create drop info list" -a list -d "List all database schemas"

# schema clone options
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from clone" -l include-data -d "Include table data in the clone"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from clone" -l exclude -x -d "Tables to exclude from cloning"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from clone" -l tenant -x -d "Create target as tenant schema with specified ID"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from clone" -l force -d "Skip confirmation prompt"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from clone" -s v -l verbose -d "Show detailed output"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from clone" -s c -l config -r -F -d "Path to configuration file"

# schema compare options
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from compare" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from compare" -s v -l verbose -d "Show detailed output"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from compare" -s c -l config -r -F -d "Path to configuration file"

# schema create options
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from create" -l tenant -x -d "Create as tenant schema with specified ID"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from create" -l if-not-exists -d "Do not error if schema already exists"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from create" -l force -d "Skip confirmation prompt"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from create" -s v -l verbose -d "Show detailed output"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from create" -s c -l config -r -F -d "Path to configuration file"

# schema drop options
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from drop" -l cascade -d "Drop all objects in the schema (CASCADE)"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from drop" -l if-exists -d "Do not error if schema does not exist"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from drop" -l force -d "Skip confirmation prompt"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from drop" -s v -l verbose -d "Show detailed output"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from drop" -s c -l config -r -F -d "Path to configuration file"

# schema info options
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from info" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from info" -l indexes -d "Show index information"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from info" -l foreign-keys -d "Show foreign key relationships"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from info" -s v -l verbose -d "Show all details"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from info" -s c -l config -r -F -d "Path to configuration file"

# schema list options
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from list" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from list" -l tenant -d "Only show tenant schemas"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from list" -s v -l verbose -d "Show detailed information"
complete -c kysera -n "__fish_seen_subcommand_from schema; and __fish_seen_subcommand_from list" -s c -l config -r -F -d "Path to configuration file"

# rls subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from rls; and not __fish_seen_subcommand_from generate migration" -a generate -d "Generate native PostgreSQL RLS statements from an RLS schema module"
complete -c kysera -f -n "__fish_seen_subcommand_from rls; and not __fish_seen_subcommand_from generate migration" -a migration -d "Generate a Kysely migration file applying native PostgreSQL RLS policies"

# rls generate options
complete -c kysera -n "__fish_seen_subcommand_from rls; and __fish_seen_subcommand_from generate" -s o -l output -r -F -d "Write SQL to a file instead of stdout"
complete -c kysera -n "__fish_seen_subcommand_from rls; and __fish_seen_subcommand_from generate" -l drop -d "Generate DROP/DISABLE statements instead of CREATE/ENABLE"
complete -c kysera -n "__fish_seen_subcommand_from rls; and __fish_seen_subcommand_from generate" -l functions -d "Prepend the RLS context helper functions (rls_current_user_id, ...)"
complete -c kysera -n "__fish_seen_subcommand_from rls; and __fish_seen_subcommand_from generate" -s s -l schema -x -d "PostgreSQL schema name"
complete -c kysera -n "__fish_seen_subcommand_from rls; and __fish_seen_subcommand_from generate" -l policy-prefix -x -d "Prefix for generated policy names"
complete -c kysera -n "__fish_seen_subcommand_from rls; and __fish_seen_subcommand_from generate" -l no-force -d "Skip FORCE ROW LEVEL SECURITY (table owners bypass RLS)"
complete -c kysera -n "__fish_seen_subcommand_from rls; and __fish_seen_subcommand_from generate" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from rls; and __fish_seen_subcommand_from generate" -s c -l config -r -F -d "Path to configuration file"

# rls migration options
complete -c kysera -n "__fish_seen_subcommand_from rls; and __fish_seen_subcommand_from migration" -s d -l dir -r -F -d "Migrations directory (default: from configuration)"
complete -c kysera -n "__fish_seen_subcommand_from rls; and __fish_seen_subcommand_from migration" -s n -l name -x -d "Migration name"
complete -c kysera -n "__fish_seen_subcommand_from rls; and __fish_seen_subcommand_from migration" -s s -l schema -x -d "PostgreSQL schema name"
complete -c kysera -n "__fish_seen_subcommand_from rls; and __fish_seen_subcommand_from migration" -l policy-prefix -x -d "Prefix for generated policy names"
complete -c kysera -n "__fish_seen_subcommand_from rls; and __fish_seen_subcommand_from migration" -l no-force -d "Skip FORCE ROW LEVEL SECURITY (table owners bypass RLS)"
complete -c kysera -n "__fish_seen_subcommand_from rls; and __fish_seen_subcommand_from migration" -l no-functions -d "Omit the RLS context helper functions from the migration"
complete -c kysera -n "__fish_seen_subcommand_from rls; and __fish_seen_subcommand_from migration" -s c -l config -r -F -d "Path to configuration file"

# init options
complete -c kysera -n "__fish_seen_subcommand_from init" -s t -l template -x -a "basic api graphql monorepo" -d "Project template (basic/api/graphql/monorepo)"
complete -c kysera -n "__fish_seen_subcommand_from init" -s d -l database -x -a "postgres mysql sqlite" -d "Database dialect (postgres/mysql/sqlite)"
complete -c kysera -n "__fish_seen_subcommand_from init" -s p -l plugins -x -d "Comma-separated list of plugins"
complete -c kysera -n "__fish_seen_subcommand_from init" -l package-manager -x -a "npm pnpm yarn bun" -d "Package manager (npm/pnpm/yarn/bun)"
complete -c kysera -n "__fish_seen_subcommand_from init" -l typescript -d "Use TypeScript"
complete -c kysera -n "__fish_seen_subcommand_from init" -l no-typescript -d "Use JavaScript"
complete -c kysera -n "__fish_seen_subcommand_from init" -l git -d "Initialize git repository"
complete -c kysera -n "__fish_seen_subcommand_from init" -l no-git -d "Skip git initialization"
complete -c kysera -n "__fish_seen_subcommand_from init" -l install -d "Install dependencies"
complete -c kysera -n "__fish_seen_subcommand_from init" -l no-install -d "Skip dependency installation"

# doctor options
complete -c kysera -n "__fish_seen_subcommand_from doctor" -l json -d "Output as JSON"
complete -c kysera -n "__fish_seen_subcommand_from doctor" -s c -l config -r -F -d "Path to configuration file"

# help completes command names
complete -c kysera -f -n "__fish_seen_subcommand_from help" -a init -d "Initialize a new Kysera project"
complete -c kysera -f -n "__fish_seen_subcommand_from help" -a doctor -d "Diagnose environment, configuration and database health"
complete -c kysera -f -n "__fish_seen_subcommand_from help" -a migrate -d "Database migration management"
complete -c kysera -f -n "__fish_seen_subcommand_from help" -a generate -d "Code generation utilities"
complete -c kysera -f -n "__fish_seen_subcommand_from help" -a db -d "Database management utilities"
complete -c kysera -f -n "__fish_seen_subcommand_from help" -a health -d "Database health monitoring"
complete -c kysera -f -n "__fish_seen_subcommand_from help" -a audit -d "Audit logging and history"
complete -c kysera -f -n "__fish_seen_subcommand_from help" -a debug -d "Debug and diagnostic utilities"
complete -c kysera -f -n "__fish_seen_subcommand_from help" -a query -d "Query utilities and analysis"
complete -c kysera -f -n "__fish_seen_subcommand_from help" -a repository -d "Repository pattern utilities"
complete -c kysera -f -n "__fish_seen_subcommand_from help" -a test -d "Test environment management"
complete -c kysera -f -n "__fish_seen_subcommand_from help" -a plugin -d "Plugin management"
complete -c kysera -f -n "__fish_seen_subcommand_from help" -a schema -d "PostgreSQL schema management"
complete -c kysera -f -n "__fish_seen_subcommand_from help" -a rls -d "Row-Level Security utilities"
