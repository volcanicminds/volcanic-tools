/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The logger of the toolkit: six one-line functions, and every line is a guard.
//
// This module runs inside somebody else's process. It writes nothing of its own: it forwards to
// whatever logger the host put on `global.log`, and only while the host has logging switched on.
// So what is worth testing is not the formatting, it is the three ways it must refuse to be a
// problem: silence when the switch is off, silence when there is no logger at all (a migration
// script or a CLI has none, and a crash there would be caused by the logging and not by the
// work), and silence when the host's logger lacks a level.
//
import { expect } from 'expect'
import * as log from '../../lib/util/logger.js'

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const

type Call = { level: string; args: any[] }

function recorder(levels: readonly string[] = LEVELS) {
  const calls: Call[] = []
  const logger: Record<string, any> = {}
  for (const level of levels) logger[level] = (...args: any[]) => calls.push({ level, args })
  return { logger, calls }
}

let savedLog: any
let savedEnabled: any

describe('logger', () => {
  beforeEach(() => {
    savedLog = (globalThis as any).log
    savedEnabled = (globalThis as any).isLoggingEnabled
  })

  afterEach(() => {
    // Mocha runs every spec file in one process: globals borrowed here are given back, or the
    // next suite inherits a logger it never set.
    ;(globalThis as any).log = savedLog
    ;(globalThis as any).isLoggingEnabled = savedEnabled
  })

  it('forwards each level to the host logger, with every argument', () => {
    const { logger, calls } = recorder()
    ;(globalThis as any).log = logger
    ;(globalThis as any).isLoggingEnabled = true

    for (const level of LEVELS) log[level](`${level} message`, { at: level }, 42)

    expect(calls.map((c) => c.level)).toEqual([...LEVELS])
    // The extra arguments matter: a logger called with only the first one silently loses the
    // context that makes a line worth reading.
    expect(calls[0].args).toEqual(['trace message', { at: 'trace' }, 42])
    expect(calls[5].args).toEqual(['fatal message', { at: 'fatal' }, 42])
  })

  it('says nothing while the host has logging switched off', () => {
    const { logger, calls } = recorder()
    ;(globalThis as any).log = logger
    ;(globalThis as any).isLoggingEnabled = false

    for (const level of LEVELS) log[level]('should not be written')

    expect(calls).toEqual([])
  })

  it('treats an unset switch as off, instead of writing by default', () => {
    // A library that starts talking because nobody told it not to is a library that prints a
    // consumer's payloads into a log the consumer did not ask for.
    const { logger, calls } = recorder()
    ;(globalThis as any).log = logger
    delete (globalThis as any).isLoggingEnabled

    for (const level of LEVELS) log[level]('should not be written')

    expect(calls).toEqual([])
  })

  it('does not throw when there is no logger at all', () => {
    // A migration script or a CLI has no `global.log`. Failing here would make the logging the
    // cause of the failure, which is the one thing logging must never be.
    ;(globalThis as any).isLoggingEnabled = true
    delete (globalThis as any).log
    for (const level of LEVELS) expect(() => log[level]('no logger here')).not.toThrow()

    ;(globalThis as any).log = null
    for (const level of LEVELS) expect(() => log[level]('null logger')).not.toThrow()
  })

  it('skips a level the host logger does not have', () => {
    // Not every logger implements `trace` or `fatal`. The missing ones are dropped; the ones
    // that exist still work, so half a logger is not no logger.
    const { logger, calls } = recorder(['info', 'error'])
    ;(globalThis as any).log = logger
    ;(globalThis as any).isLoggingEnabled = true

    for (const level of LEVELS) expect(() => log[level]('hello')).not.toThrow()

    expect(calls.map((c) => c.level)).toEqual(['info', 'error'])
  })

  it('reads the switch at every call, so turning it on takes effect immediately', () => {
    // The flag is read per call and not captured at import time: a host that raises the level
    // while running would otherwise keep the silence it had at boot.
    const { logger, calls } = recorder()
    ;(globalThis as any).log = logger
    ;(globalThis as any).isLoggingEnabled = false

    log.info('before')
    ;(globalThis as any).isLoggingEnabled = true
    log.info('after')

    expect(calls.map((c) => c.args[0])).toEqual(['after'])
  })
})
