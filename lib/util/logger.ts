export function trace(data: unknown, ...args: unknown[]) {
  if (global.isLoggingEnabled && global.log?.trace) {
    global.log.trace(data, ...args)
  }
}

export function debug(data: unknown, ...args: unknown[]) {
  if (global.isLoggingEnabled && global.log?.debug) {
    global.log.debug(data, ...args)
  }
}

export function info(data: unknown, ...args: unknown[]) {
  if (global.isLoggingEnabled && global.log?.info) {
    global.log.info(data, ...args)
  }
}

export function warn(data: unknown, ...args: unknown[]) {
  if (global.isLoggingEnabled && global.log?.warn) {
    global.log.warn(data, ...args)
  }
}

export function error(data: unknown, ...args: unknown[]) {
  if (global.isLoggingEnabled && global.log?.error) {
    global.log.error(data, ...args)
  }
}

export function fatal(data: unknown, ...args: unknown[]) {
  if (global.isLoggingEnabled && global.log?.fatal) {
    global.log.fatal(data, ...args)
  }
}
