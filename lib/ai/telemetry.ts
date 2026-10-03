import type { Telemetry } from 'ai'

const OTEL_PEER = '@ai-sdk/otel'

declare global {
  // The AI SDK's process-wide integration registry: `registerTelemetry` appends to it, with no
  // check for duplicates, and the SDK exports no reader.
  var AI_SDK_TELEMETRY_INTEGRATIONS: Telemetry[] | undefined
}

/** Whether prompts, responses and embedded texts go into the spans: off unless asked for. */
export function recordsContent(): boolean {
  return /^true$/i.test(process.env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT ?? '')
}

let registration: Promise<void> | undefined

/**
 * Registers the AI SDK's OpenTelemetry integration, once per process, on the first AI call of this
 * module. Installing `@ai-sdk/otel` is the opt-in, `AI_TELEMETRY=false` the opt-out; an integration
 * the application registered itself is left alone, or every span would be emitted twice.
 *
 * The registry is process-wide: from here on every AI SDK call is traced, including the ones the
 * application makes directly. An application that wants the calls before the first one of this
 * module traced registers the integration itself, before them.
 */
export function ensureTelemetry(): Promise<void> {
  registration ??= register()
  return registration
}

async function register(): Promise<void> {
  if (/^false$/i.test(process.env.AI_TELEMETRY ?? '')) return

  let OpenTelemetry: typeof import('@ai-sdk/otel').OpenTelemetry
  try {
    ;({ OpenTelemetry } = await import('@ai-sdk/otel'))
  } catch (error) {
    const { code, message } = error as { code?: unknown; message?: unknown }
    if (code === 'ERR_MODULE_NOT_FOUND' && typeof message === 'string' && message.includes(OTEL_PEER)) return
    throw error
  }

  if ((globalThis.AI_SDK_TELEMETRY_INTEGRATIONS ?? []).some((i) => i instanceof OpenTelemetry)) return

  const { registerTelemetry } = await import('ai')
  // Embedded texts are content like prompts: `embedding` lets them through, the record flags decide.
  registerTelemetry(contentOffByDefault(new OpenTelemetry({ embedding: true }), recordsContent()))
}

/**
 * The SDK records inputs and outputs unless a call says `false`. Every event reaches the
 * integration with the call's own `recordInputs` and `recordOutputs`: where the call left them
 * unset, they take the process default instead, so an agent or a call that sets them still wins.
 */
function contentOffByDefault(integration: Telemetry, content: boolean): Telemetry {
  const withDefault = (event: unknown): unknown => {
    if (typeof event !== 'object' || event === null || !('recordInputs' in event)) return event
    const { recordInputs, recordOutputs } = event as { recordInputs?: boolean; recordOutputs?: boolean }
    return Object.assign(Object.create(Object.getPrototypeOf(event)), event, {
      recordInputs: recordInputs ?? content,
      recordOutputs: recordOutputs ?? content
    })
  }
  return new Proxy(integration, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      return (event: unknown, ...rest: unknown[]) => value.call(target, withDefault(event), ...rest)
    }
  })
}
