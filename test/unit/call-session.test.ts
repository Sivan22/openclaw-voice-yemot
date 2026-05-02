import { describe, it, expect } from 'vitest'
import { CallSession, SessionRegistry } from '../../src/call-session.js'

describe('CallSession', () => {
  it('initializes with all required fields', () => {
    const s = new CallSession({
      callId: 'YF-1',
      phone: '0521234567',
      did: '0772345678',
      realDid: '0772345678',
      extension: '1',
      language: 'he-IL',
    })
    expect(s.state.callId).toBe('YF-1')
    expect(s.state.phone).toBe('0521234567')
    expect(s.state.transcript).toEqual([])
    expect(s.state.turnCount).toBe(0)
    expect(s.state.consecutiveEmptyInputs).toBe(0)
    expect(s.state.abortController).toBeInstanceOf(AbortController)
    expect(s.state.startedAt).toBeGreaterThan(0)
  })

  it('appendTranscript pushes entries and bumps lastTurnAt', () => {
    const s = new CallSession({
      callId: 'YF-2', phone: 'p', did: 'd', realDid: 'd', extension: '1', language: 'he-IL',
    })
    const before = s.state.lastTurnAt
    s.appendTranscript({ speaker: 'user', text: 'שלום', isFinal: true })
    expect(s.state.transcript).toHaveLength(1)
    expect(s.state.transcript[0]?.speaker).toBe('user')
    expect(s.state.transcript[0]?.ts).toBeGreaterThan(0)
    expect(s.state.lastTurnAt).toBeGreaterThanOrEqual(before)
  })

  it('incTurn / resetEmpty / incEmpty work', () => {
    const s = new CallSession({
      callId: 'YF-3', phone: 'p', did: 'd', realDid: 'd', extension: '1', language: 'he-IL',
    })
    s.incTurn(); s.incTurn()
    expect(s.state.turnCount).toBe(2)
    s.incEmpty(); s.incEmpty()
    expect(s.state.consecutiveEmptyInputs).toBe(2)
    s.resetEmpty()
    expect(s.state.consecutiveEmptyInputs).toBe(0)
  })

  it('abort() signals the abort controller', () => {
    const s = new CallSession({
      callId: 'YF-4', phone: 'p', did: 'd', realDid: 'd', extension: '1', language: 'he-IL',
    })
    expect(s.state.abortController.signal.aborted).toBe(false)
    s.abort('hangup-user')
    expect(s.state.abortController.signal.aborted).toBe(true)
  })
})

describe('SessionRegistry', () => {
  it('add / get / delete work and active count is correct', () => {
    const r = new SessionRegistry()
    expect(r.size()).toBe(0)
    const s1 = new CallSession({ callId: 'A', phone:'1', did:'d', realDid:'d', extension:'1', language:'he-IL' })
    const s2 = new CallSession({ callId: 'B', phone:'2', did:'d', realDid:'d', extension:'1', language:'he-IL' })
    r.add(s1); r.add(s2)
    expect(r.size()).toBe(2)
    expect(r.get('A')).toBe(s1)
    r.delete('A')
    expect(r.get('A')).toBeUndefined()
    expect(r.size()).toBe(1)
  })

  it('list returns shallow copies of all sessions', () => {
    const r = new SessionRegistry()
    r.add(new CallSession({ callId:'A', phone:'1', did:'d', realDid:'d', extension:'1', language:'he-IL' }))
    r.add(new CallSession({ callId:'B', phone:'2', did:'d', realDid:'d', extension:'1', language:'he-IL' }))
    const list = r.list()
    expect(list).toHaveLength(2)
    expect(list.map(s => s.state.callId).sort()).toEqual(['A', 'B'])
  })
})
