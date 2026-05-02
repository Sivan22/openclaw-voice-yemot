const FORBIDDEN_TTS_CHARS = /[.\-"'&|]/g

export function stripInvalidTtsChars(text: string): string {
  return text.replace(FORBIDDEN_TTS_CHARS, '')
}

export interface YemotMsg {
  type: 'text' | 'file' | 'system_message'
  data: string
}

export interface RenderOptions {
  stripInvalidChars: boolean
}

export function renderPromptDirective(
  text: string,
  opts: RenderOptions
): YemotMsg[] {
  const s = String(text ?? '')
  const data = opts.stripInvalidChars ? stripInvalidTtsChars(s) : s
  return [{ type: 'text', data }]
}
