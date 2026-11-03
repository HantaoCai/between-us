import { cloudProxyBaseUrl, cloudProxyToken } from './proxyConfig'
import { isJevConfigured } from './jevConfig'

export type JevChoiceQuestion = {
  type: 'choice'
  instructions: string
  criteria: Record<string, string | null>
}

export type JevNoulQuestion = {
  type: 'noul'
  instructions: string
  criteria?: { true?: string; false?: string }
}

export type JevQuestion = JevChoiceQuestion | JevNoulQuestion

export type JevChoiceAnswer = {
  type: 'choice'
  choice: string
  confidence?: number
  probabilities?: Record<string, number>
}

export type JevNoulAnswer = {
  type: 'noul'
  noul: number
}

export type JevAnswer = JevChoiceAnswer | JevNoulAnswer

type JevOk = {
  ok: true
  model?: string
  answers: Record<string, JevAnswer>
  usage?: { input_tokens?: number; output_tokens?: number }
}

type JevErr = {
  ok: false
  error: string
}

export async function callJev(input: {
  state: unknown
  questions: Record<string, JevQuestion>
  model?: string
  signal?: AbortSignal
}): Promise<JevOk> {
  if (!isJevConfigured()) {
    throw new Error('未配置 Cloudflare Worker 地址')
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  const token = cloudProxyToken()
  if (token) headers['X-Between-Us-Token'] = token

  const res = await fetch(`${cloudProxyBaseUrl()}/jev`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      state: input.state,
      questions: input.questions,
      model: input.model,
    }),
    signal: input.signal,
  })

  let data: JevOk | JevErr
  try {
    data = (await res.json()) as JevOk | JevErr
  } catch {
    throw new Error(`Worker /jev 返回非 JSON（HTTP ${res.status}）`)
  }

  if (!res.ok || !data || data.ok === false) {
    const err = data && 'error' in data ? data.error : `HTTP ${res.status}`
    throw new Error(err)
  }
  if (!data.answers || typeof data.answers !== 'object') {
    throw new Error('Jev 响应缺少 answers')
  }
  return data
}

export async function jevPickChoice(
  state: unknown,
  instructions: string,
  criteria: Record<string, string | null>,
  opts?: { signal?: AbortSignal; model?: string },
): Promise<{ choice: string; confidence?: number; probabilities?: Record<string, number> }> {
  const resp = await callJev({
    state,
    questions: {
      pick: { type: 'choice', instructions, criteria },
    },
    model: opts?.model,
    signal: opts?.signal,
  })
  const ans = resp.answers.pick
  if (!ans || ans.type !== 'choice' || typeof ans.choice !== 'string') {
    throw new Error('Jev 未返回 choice')
  }
  return {
    choice: ans.choice,
    confidence: ans.confidence,
    probabilities: ans.probabilities,
  }
}
