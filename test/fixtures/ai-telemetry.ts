// One scenario of the AI module's telemetry, in a process of its own: the AI SDK's integration
// registry is process-wide. Runs an agent and an embedding against an in-memory span exporter and
// prints what the spans recorded, as one JSON line.
import { registerHooks } from 'node:module'
import { trace } from '@opentelemetry/api'
import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { MockEmbeddingModelV4, MockLanguageModelV4 } from 'ai/test'

const scenario = process.argv[2]

if (scenario === 'missing') {
  // As if @ai-sdk/otel were not installed.
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '@ai-sdk/otel') {
        throw Object.assign(new Error(`Cannot find package '@ai-sdk/otel'`), { code: 'ERR_MODULE_NOT_FOUND' })
      }
      return nextResolve(specifier, context)
    }
  })
}

const exporter = new InMemorySpanExporter()
trace.setGlobalTracerProvider(new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }))

if (scenario === 'preregistered') {
  const { registerTelemetry } = await import('ai')
  const { OpenTelemetry } = await import('@ai-sdk/otel')
  registerTelemetry(new OpenTelemetry())
}

const { createAgent, embedTexts } = await import('../../lib/ai/index.js')

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 }
}
const model = new MockLanguageModelV4({
  doGenerate: async () => ({
    content: [{ type: 'text', text: 'pong' }],
    finishReason: { unified: 'stop', raw: undefined },
    usage,
    warnings: []
  })
})
const agent = await createAgent({
  name: 'probe',
  instructions: 'Be brief.',
  model,
  ...(scenario === 'agent-records-inputs' && { telemetry: { recordInputs: true } })
})
await agent.generate({ prompt: 'ping' })
await embedTexts(
  ['ping'],
  new MockEmbeddingModelV4({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => [1, 0]), warnings: [] }) })
)

const spans = exporter.getFinishedSpans()
const has = (key: string) => spans.some((span) => key in span.attributes)
console.log(
  JSON.stringify({
    integrations: globalThis.AI_SDK_TELEMETRY_INTEGRATIONS?.length ?? 0,
    agents: [...new Set(spans.map((span) => span.attributes['gen_ai.agent.name']).filter(Boolean))],
    inputs: has('gen_ai.input.messages'),
    outputs: has('gen_ai.output.messages'),
    embedded: has('ai.values')
  })
)
