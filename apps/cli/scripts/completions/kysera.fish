# Fish completion for kysera CLI
# Installation:
#   Copy this file to ~/.config/fish/completions/kysera.fish
#   Or copy to /usr/share/fish/vendor_completions.d/kysera.fish (system-wide)

# Remove any existing completions
complete -c kysera -e

# Global options (available for all commands)
complete -c kysera -l help -d "Show help information"
complete -c kysera -l version -d "Show version number"
complete -c kysera -s v -l verbose -d "Detailed output"
complete -c kysera -s q -l quiet -d "Minimal output"
complete -c kysera -l dry-run -d "Preview without executing"
complete -c kysera -l json -d "JSON output format"
complete -c kysera -l config -d "Custom config file" -r -F
complete -c kysera -l no-color -d "Disable colored output"

# Main commands
complete -c kysera -f -n "__fish_use_subcommand" -a init -d "Initialize a new Kysera project"
complete -c kysera -f -n "__fish_use_subcommand" -a migrate -d "Database migration management"
complete -c kysera -f -n "__fish_use_subcommand" -a generate -d "Code generation utilities"
complete -c kysera -f -n "__fish_use_subcommand" -a db -d "Database management tools"
complete -c kysera -f -n "__fish_use_subcommand" -a health -d "Health monitoring and metrics"
complete -c kysera -f -n "__fish_use_subcommand" -a audit -d "Audit logging and history"
complete -c kysera -f -n "__fish_use_subcommand" -a debug -d "Debug and diagnostic tools"
complete -c kysera -f -n "__fish_use_subcommand" -a query -d "Query analysis and utilities"
complete -c kysera -f -n "__fish_use_subcommand" -a repository -d "Repository pattern utilities"
complete -c kysera -f -n "__fish_use_subcommand" -a test -d "Test environment management"
complete -c kysera -f -n "__fish_use_subcommand" -a plugin -d "Plugin management"
complete -c kysera -f -n "__fish_use_subcommand" -a help -d "Show help information"

# init command options
complete -c kysera -n "__fish_seen_subcommand_from init" -l dialect -d "Database dialect" -r -f -a "postgres mysql sqlite"
complete -c kysera -n "__fish_seen_subcommand_from init" -l typescript -d "Use TypeScript"
complete -c kysera -n "__fish_seen_subcommand_from init" -l javascript -d "Use JavaScript"
complete -c kysera -n "__fish_seen_subcommand_from init" -l with-examples -d "Include example files"
complete -c kysera -n "__fish_seen_subcommand_from init" -l skip-git -d "Skip git initialization"

# migrate subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from migrate; and not __fish_seen_subcommand_from create up down status list reset fresh rollback" -a create -d "Create a new migration file"
complete -c kysera -f -n "__fish_seen_subcommand_from migrate; and not __fish_seen_subcommand_from create up down status list reset fresh rollback" -a up -d "Run pending migrations"
complete -c kysera -f -n "__fish_seen_subcommand_from migrate; and not __fish_seen_subcommand_from create up down status list reset fresh rollback" -a down -d "Rollback the last migration"
complete -c kysera -f -n "__fish_seen_subcommand_from migrate; and not __fish_seen_subcommand_from create up down status list reset fresh rollback" -a status -d "Show migration status"
complete -c kysera -f -n "__fish_seen_subcommand_from migrate; and not __fish_seen_subcommand_from create up down status list reset fresh rollback" -a list -d "List all migrations"
complete -c kysera -f -n "__fish_seen_subcommand_from migrate; and not __fish_seen_subcommand_from create up down status list reset fresh rollback" -a reset -d "Reset all migrations"
complete -c kysera -f -n "__fish_seen_subcommand_from migrate; and not __fish_seen_subcommand_from create up down status list reset fresh rollback" -a fresh -d "Drop all tables and re-run migrations"
complete -c kysera -f -n "__fish_seen_subcommand_from migrate; and not __fish_seen_subcommand_from create up down status list reset fresh rollback" -a rollback -d "Rollback migrations"

# migrate command options
complete -c kysera -n "__fish_seen_subcommand_from migrate" -l name -d "Migration name" -r
complete -c kysera -n "__fish_seen_subcommand_from migrate" -l table -d "Table name" -r
complete -c kysera -n "__fish_seen_subcommand_from migrate" -l all -d "Apply to all migrations"
complete -c kysera -n "__fish_seen_subcommand_from migrate" -l step -d "Number of migrations" -r
complete -c kysera -n "__fish_seen_subcommand_from migrate" -l to -d "Target migration" -r

# generate subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from generate; and not __fish_seen_subcommand_from model repository schema crud migration" -a model -d "Generate a model class"
complete -c kysera -f -n "__fish_seen_subcommand_from generate; and not __fish_seen_subcommand_from model repository schema crud migration" -a repository -d "Generate a repository class"
complete -c kysera -f -n "__fish_seen_subcommand_from generate; and not __fish_seen_subcommand_from model repository schema crud migration" -a schema -d "Generate a schema definition"
complete -c kysera -f -n "__fish_seen_subcommand_from generate; and not __fish_seen_subcommand_from model repository schema crud migration" -a crud -d "Generate complete CRUD operations"
complete -c kysera -f -n "__fish_seen_subcommand_from generate; and not __fish_seen_subcommand_from model repository schema crud migration" -a migration -d "Generate a migration file"

# generate command options
complete -c kysera -n "__fish_seen_subcommand_from generate" -l table -d "Table name" -r
complete -c kysera -n "__fish_seen_subcommand_from generate" -l output -d "Output directory" -r -F
complete -c kysera -n "__fish_seen_subcommand_from generate" -l with-validation -d "Include validation"
complete -c kysera -n "__fish_seen_subcommand_from generate" -l with-tests -d "Generate tests"
complete -c kysera -n "__fish_seen_subcommand_from generate" -l api -d "Generate API endpoints"
complete -c kysera -n "__fish_seen_subcommand_from generate" -l crud -d "Generate CRUD operations"
complete -c kysera -n "__fish_seen_subcommand_from generate" -l validation -d "Validation library" -r -f -a "zod yup joi none"

# db subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from db; and not __fish_seen_subcommand_from seed reset tables dump restore introspect console" -a seed -d "Seed the database"
complete -c kysera -f -n "__fish_seen_subcommand_from db; and not __fish_seen_subcommand_from seed reset tables dump restore introspect console" -a reset -d "Reset the database"
complete -c kysera -f -n "__fish_seen_subcommand_from db; and not __fish_seen_subcommand_from seed reset tables dump restore introspect console" -a tables -d "List all tables"
complete -c kysera -f -n "__fish_seen_subcommand_from db; and not __fish_seen_subcommand_from seed reset tables dump restore introspect console" -a dump -d "Dump database to file"
complete -c kysera -f -n "__fish_seen_subcommand_from db; and not __fish_seen_subcommand_from seed reset tables dump restore introspect console" -a restore -d "Restore database from dump"
complete -c kysera -f -n "__fish_seen_subcommand_from db; and not __fish_seen_subcommand_from seed reset tables dump restore introspect console" -a introspect -d "Introspect database schema"
complete -c kysera -f -n "__fish_seen_subcommand_from db; and not __fish_seen_subcommand_from seed reset tables dump restore introspect console" -a console -d "Open database console"

# db command options
complete -c kysera -n "__fish_seen_subcommand_from db" -l force -d "Force operation without confirmation"
complete -c kysera -n "__fish_seen_subcommand_from db" -l output -d "Output file" -r -F
complete -c kysera -n "__fish_seen_subcommand_from db" -l format -d "Output format" -r -f -a "sql json yaml"
complete -c kysera -n "__fish_seen_subcommand_from db" -l env -d "Environment" -r -f -a "development test production"

# health subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from health; and not __fish_seen_subcommand_from check watch metrics" -a check -d "Check database health"
complete -c kysera -f -n "__fish_seen_subcommand_from health; and not __fish_seen_subcommand_from check watch metrics" -a watch -d "Watch health metrics"
complete -c kysera -f -n "__fish_seen_subcommand_from health; and not __fish_seen_subcommand_from check watch metrics" -a metrics -d "Show detailed metrics"

# health command options
complete -c kysera -n "__fish_seen_subcommand_from health" -l interval -d "Check interval in seconds" -r
complete -c kysera -n "__fish_seen_subcommand_from health" -l format -d "Output format" -r -f -a "table json"
complete -c kysera -n "__fish_seen_subcommand_from health" -l threshold -d "Alert threshold" -r

# audit subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from audit; and not __fish_seen_subcommand_from logs history restore stats cleanup compare diff" -a logs -d "Show audit logs"
complete -c kysera -f -n "__fish_seen_subcommand_from audit; and not __fish_seen_subcommand_from logs history restore stats cleanup compare diff" -a history -d "Show entity history"
complete -c kysera -f -n "__fish_seen_subcommand_from audit; and not __fish_seen_subcommand_from logs history restore stats cleanup compare diff" -a restore -d "Restore entity state"
complete -c kysera -f -n "__fish_seen_subcommand_from audit; and not __fish_seen_subcommand_from logs history restore stats cleanup compare diff" -a stats -d "Show audit statistics"
complete -c kysera -f -n "__fish_seen_subcommand_from audit; and not __fish_seen_subcommand_from logs history restore stats cleanup compare diff" -a cleanup -d "Cleanup old audit logs"
complete -c kysera -f -n "__fish_seen_subcommand_from audit; and not __fish_seen_subcommand_from logs history restore stats cleanup compare diff" -a compare -d "Compare entity versions"
complete -c kysera -f -n "__fish_seen_subcommand_from audit; and not __fish_seen_subcommand_from logs history restore stats cleanup compare diff" -a diff -d "Show differences between versions"

# audit command options
complete -c kysera -n "__fish_seen_subcommand_from audit" -l from -d "Start date" -r
complete -c kysera -n "__fish_seen_subcommand_from audit" -l to -d "End date" -r
complete -c kysera -n "__fish_seen_subcommand_from audit" -l entity -d "Entity type" -r
complete -c kysera -n "__fish_seen_subcommand_from audit" -l limit -d "Result limit" -r
complete -c kysera -n "__fish_seen_subcommand_from audit" -l format -d "Output format" -r -f -a "table json"

# debug subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from debug; and not __fish_seen_subcommand_from connection schema queries slow-queries explain" -a connection -d "Test database connection"
complete -c kysera -f -n "__fish_seen_subcommand_from debug; and not __fish_seen_subcommand_from connection schema queries slow-queries explain" -a schema -d "Show schema information"
complete -c kysera -f -n "__fish_seen_subcommand_from debug; and not __fish_seen_subcommand_from connection schema queries slow-queries explain" -a queries -d "Show recent queries"
complete -c kysera -f -n "__fish_seen_subcommand_from debug; and not __fish_seen_subcommand_from connection schema queries slow-queries explain" -a slow-queries -d "Show slow queries"
complete -c kysera -f -n "__fish_seen_subcommand_from debug; and not __fish_seen_subcommand_from connection schema queries slow-queries explain" -a explain -d "Explain query execution"

# query subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from query; and not __fish_seen_subcommand_from analyze explain optimize index suggest" -a analyze -d "Analyze query performance"
complete -c kysera -f -n "__fish_seen_subcommand_from query; and not __fish_seen_subcommand_from analyze explain optimize index suggest" -a explain -d "Explain query execution plan"
complete -c kysera -f -n "__fish_seen_subcommand_from query; and not __fish_seen_subcommand_from analyze explain optimize index suggest" -a optimize -d "Suggest query optimizations"
complete -c kysera -f -n "__fish_seen_subcommand_from query; and not __fish_seen_subcommand_from analyze explain optimize index suggest" -a index -d "Suggest index improvements"
complete -c kysera -f -n "__fish_seen_subcommand_from query; and not __fish_seen_subcommand_from analyze explain optimize index suggest" -a suggest -d "Suggest query improvements"

# repository subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from repository; and not __fish_seen_subcommand_from list create scaffold validate test" -a list -d "List all repositories"
complete -c kysera -f -n "__fish_seen_subcommand_from repository; and not __fish_seen_subcommand_from list create scaffold validate test" -a create -d "Create a new repository"
complete -c kysera -f -n "__fish_seen_subcommand_from repository; and not __fish_seen_subcommand_from list create scaffold validate test" -a scaffold -d "Scaffold repository structure"
complete -c kysera -f -n "__fish_seen_subcommand_from repository; and not __fish_seen_subcommand_from list create scaffold validate test" -a validate -d "Validate repository implementation"
complete -c kysera -f -n "__fish_seen_subcommand_from repository; and not __fish_seen_subcommand_from list create scaffold validate test" -a test -d "Test repository operations"

# test subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from test; and not __fish_seen_subcommand_from setup teardown seed fixtures run" -a setup -d "Setup test environment"
complete -c kysera -f -n "__fish_seen_subcommand_from test; and not __fish_seen_subcommand_from setup teardown seed fixtures run" -a teardown -d "Teardown test environment"
complete -c kysera -f -n "__fish_seen_subcommand_from test; and not __fish_seen_subcommand_from setup teardown seed fixtures run" -a seed -d "Seed test data"
complete -c kysera -f -n "__fish_seen_subcommand_from test; and not __fish_seen_subcommand_from setup teardown seed fixtures run" -a fixtures -d "Load test fixtures"
complete -c kysera -f -n "__fish_seen_subcommand_from test; and not __fish_seen_subcommand_from setup teardown seed fixtures run" -a run -d "Run tests"

# test command options
complete -c kysera -n "__fish_seen_subcommand_from test" -l env -d "Environment" -r -f -a "development test production"
complete -c kysera -n "__fish_seen_subcommand_from test" -l count -d "Number of records" -r
complete -c kysera -n "__fish_seen_subcommand_from test" -l strategy -d "Seeding strategy" -r -f -a "realistic minimal random faker"
complete -c kysera -n "__fish_seen_subcommand_from test" -l force -d "Force operation"

# plugin subcommands
complete -c kysera -f -n "__fish_seen_subcommand_from plugin; and not __fish_seen_subcommand_from list install uninstall enable disable info" -a list -d "List installed plugins"
complete -c kysera -f -n "__fish_seen_subcommand_from plugin; and not __fish_seen_subcommand_from list install uninstall enable disable info" -a install -d "Install a plugin"
complete -c kysera -f -n "__fish_seen_subcommand_from plugin; and not __fish_seen_subcommand_from list install uninstall enable disable info" -a uninstall -d "Uninstall a plugin"
complete -c kysera -f -n "__fish_seen_subcommand_from plugin; and not __fish_seen_subcommand_from list install uninstall enable disable info" -a enable -d "Enable a plugin"
complete -c kysera -f -n "__fish_seen_subcommand_from plugin; and not __fish_seen_subcommand_from list install uninstall enable disable info" -a disable -d "Disable a plugin"
complete -c kysera -f -n "__fish_seen_subcommand_from plugin; and not __fish_seen_subcommand_from list install uninstall enable disable info" -a info -d "Show plugin information"

# plugin command options
complete -c kysera -n "__fish_seen_subcommand_from plugin" -l global -d "Install globally"
complete -c kysera -n "__fish_seen_subcommand_from plugin" -l save -d "Save to config"
