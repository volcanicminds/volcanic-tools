export function trace(data) {
  global.isLoggingEnabled && global.log?.trace && global.log.trace(data)
}

export function debug(data) {
  global.isLoggingEnabled && global.log?.debug && global.log.debug(data)
}

export function info(data) {
  global.isLoggingEnabled && global.log?.info && global.log.info(data)
}

export function warn(data) {
  global.isLoggingEnabled && global.log?.warn && global.log.warn(data)
}

export function error(data) {
  global.isLoggingEnabled && global.log?.error && global.log.error(data)
}

export function fatal(data) {
  global.isLoggingEnabled && global.log?.fatal && global.log.fatal(data)
}
