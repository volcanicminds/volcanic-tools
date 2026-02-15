import type { ConcurrencyConfig } from './types.js'

const DEFAULT_LIMITS: ConcurrencyConfig = {
  openai: 5,
  mistral: 10,
  ollama: 2,
  google: 10,
  anthropic: 5,
}

class Semaphore {
  private running = 0
  private queue: (() => void)[] = []

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++
      return
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve)
    })
  }

  release(): void {
    this.running--
    if (this.queue.length > 0) {
      this.running++
      const next = this.queue.shift()
      if (next) next()
    }
  }
}

export class ConcurrencyGuard {
  private semaphores: Record<string, Semaphore> = {}
  private limits: ConcurrencyConfig

  constructor(customLimits: ConcurrencyConfig = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...customLimits }
  }

  /**
   * Acquires a lock for the specific provider.
   * If limit is reached, it waits in queue.
   */
  async acquire(provider: string): Promise<void> {
    const key = provider.toLowerCase()
    const limit = this.limits[key] || 2 // Default safe limit if unknown provider

    if (!this.semaphores[key]) {
      this.semaphores[key] = new Semaphore(limit)
    }

    await this.semaphores[key].acquire()
  }

  /**
   * Releases the lock. MUST be called in finally block.
   */
  release(provider: string): void {
    const key = provider.toLowerCase()
    if (this.semaphores[key]) {
      this.semaphores[key].release()
    }
  }

  /**
   * Wrapper to execute a function guarded by concurrency limit
   */
  async run<T>(provider: string, task: () => Promise<T>): Promise<T> {
    await this.acquire(provider)
    try {
      return await task()
    } finally {
      this.release(provider)
    }
  }
}
