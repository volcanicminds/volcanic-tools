import { expect } from 'expect'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// The AI SDK's integration registry is process-wide, and the registration happens once per
// process: every scenario runs in a fresh one (test/fixtures/ai-telemetry.ts).
const fixture = fileURLToPath(new URL('../fixtures/ai-telemetry.ts', import.meta.url))

function run(scenario: string, env: Record<string, string> = {}) {
  const base = { ...process.env }
  delete base.AI_TELEMETRY
  delete base.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT
  const out = execFileSync(process.execPath, ['--import=tsx', fixture, scenario], {
    env: { ...base, ...env },
    encoding: 'utf8'
  })
  return JSON.parse(out.trim().split('\n').at(-1)!)
}

describe('AI telemetry (registered on the first AI call)', function () {
  this.timeout(60000)

  it('traces the agent under its name, without prompts, responses or embedded texts', () => {
    expect(run('default')).toEqual({
      integrations: 1,
      agents: ['probe'],
      inputs: false,
      outputs: false,
      embedded: false
    })
  })

  it('records the content when the deployment asks for it', () => {
    const recorded = run('content', { OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: 'true' })
    expect(recorded).toMatchObject({ inputs: true, outputs: true, embedded: true })
  })

  it("lets an agent's own setting win over the default", () => {
    expect(run('agent-records-inputs')).toMatchObject({ inputs: true, outputs: false })
  })

  it('registers nothing with AI_TELEMETRY=false', () => {
    expect(run('disabled', { AI_TELEMETRY: 'false' })).toMatchObject({ integrations: 0, agents: [] })
  })

  it('leaves alone an integration the application registered', () => {
    expect(run('preregistered')).toMatchObject({ integrations: 1, agents: ['probe'] })
  })

  it('stays silent without @ai-sdk/otel installed', () => {
    expect(run('missing')).toMatchObject({ integrations: 0, agents: [] })
  })
})
