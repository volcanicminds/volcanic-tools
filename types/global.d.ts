/* eslint-disable @typescript-eslint/no-explicit-any */
export interface MyInterface {
  default: any
  [option: string]: any
}

declare global {
  var isLoggingEnabled: boolean
  var log: {
    trace: (data: any, ...args: any[]) => void
    debug: (data: any, ...args: any[]) => void
    info: (data: any, ...args: any[]) => void
    warn: (data: any, ...args: any[]) => void
    error: (data: any, ...args: any[]) => void
    fatal: (data: any, ...args: any[]) => void
  }
}
