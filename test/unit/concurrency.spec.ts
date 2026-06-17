import { expect } from 'expect'
import { ConcurrencyGuard } from '../../lib/ai/concurrency.js'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

describe('ConcurrencyGuard', () => {
  it('caps concurrent executions per provider', async () => {
    const guard = new ConcurrencyGuard({ openai: 2 })
    let active = 0
    let maxActive = 0
    const task = async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await delay(20)
      active--
    }
    await Promise.all(Array.from({ length: 6 }, () => guard.run('openai', task)))
    expect(maxActive).toBeLessThanOrEqual(2)
    expect(maxActive).toBeGreaterThan(0)
  })

  it('returns the task result', async () => {
    const guard = new ConcurrencyGuard()
    expect(await guard.run('unknown-provider', async () => 42)).toBe(42)
  })

  it('releases the slot when the task throws', async () => {
    const guard = new ConcurrencyGuard({ openai: 1 })
    await expect(guard.run('openai', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    // If the slot leaked, this would deadlock and time out.
    expect(await guard.run('openai', async () => 'ok')).toBe('ok')
  })
})
