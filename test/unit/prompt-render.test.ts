import { describe, it, expect } from 'vitest'
import { renderPromptDirective, stripInvalidTtsChars } from '../../src/prompt-render.js'

describe('stripInvalidTtsChars', () => {
  it('removes the six forbidden chars', () => {
    expect(stripInvalidTtsChars('hello.world-test"x\'y&z|done'))
      .toBe('helloworldtestxyzdone')
  })

  it('preserves Hebrew niqqud and standard letters', () => {
    expect(stripInvalidTtsChars('שָׁלוֹם עוֹלָם'))
      .toBe('שָׁלוֹם עוֹלָם')
  })

  it('preserves spaces, digits, and punctuation that are allowed', () => {
    expect(stripInvalidTtsChars('היום 14:00, מחר ב9'))
      .toBe('היום 14:00, מחר ב9')
  })

  it('handles empty string', () => {
    expect(stripInvalidTtsChars('')).toBe('')
  })
})

describe('renderPromptDirective', () => {
  it('returns a single text Msg when given plain Hebrew', () => {
    expect(renderPromptDirective('שלום!', { stripInvalidChars: true }))
      .toEqual([{ type: 'text', data: 'שלום!' }])
  })

  it('strips forbidden chars when stripInvalidChars=true', () => {
    expect(renderPromptDirective('שלום-עולם', { stripInvalidChars: true }))
      .toEqual([{ type: 'text', data: 'שלוםעולם' }])
  })

  it('keeps forbidden chars when stripInvalidChars=false', () => {
    expect(renderPromptDirective('שלום-עולם', { stripInvalidChars: false }))
      .toEqual([{ type: 'text', data: 'שלום-עולם' }])
  })

  it('coerces non-string text to string', () => {
    expect(renderPromptDirective(123 as unknown as string, { stripInvalidChars: true }))
      .toEqual([{ type: 'text', data: '123' }])
  })
})
