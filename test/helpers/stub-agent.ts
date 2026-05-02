import type { AgentRunInput, AgentRunner } from '../../src/agent-loop.js'

/**
 * Build a deterministic agent runner from a sequence of canned replies.
 * Each call to the runner pops the next reply from the queue.
 * Throws if the queue is exhausted (test must add enough replies).
 */
export function stubAgent(...replies: string[]): AgentRunner {
  const queue = [...replies]
  return async (_input: AgentRunInput): Promise<string> => {
    if (queue.length === 0) {
      throw new Error('stubAgent: no more canned replies (queue exhausted)')
    }
    return queue.shift()!
  }
}
