#!/usr/bin/env node

/**
 * @kysera/cli - Command-line interface for Kysera toolkit
 *
 * Entry point: launches the CLI and routes every failure through the
 * single error surface (handleError).
 */

import { cli } from './cli.js'
import { handleError } from './utils/errors.js'

process.on('uncaughtException', error => {
  handleError(error)
})

process.on('unhandledRejection', reason => {
  handleError(reason)
})

cli(process.argv).catch((error: unknown) => {
  handleError(error)
})
