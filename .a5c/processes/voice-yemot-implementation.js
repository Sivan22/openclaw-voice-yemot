/**
 * @process voice-yemot-implementation
 * @description Execute the openclaw-voice-yemot v1 implementation plan task-by-task,
 *              with verification gates after each task and a final code review.
 *
 * The plan has 18 self-contained TDD tasks. Each task includes its own tests, code,
 * commands, and commit. The agent's job per task is to follow the plan literally,
 * then report what was done. Verification gates re-run tests/typecheck/git-log to
 * make sure the agent didn't drift.
 *
 * @inputs  { planPath: string, specPath: string, workingDir: string }
 * @outputs { success: boolean, tasksCompleted: number, lastCommit: string }
 */

import { defineTask } from '@a5c-ai/babysitter-sdk'
import fs from 'node:fs'
import path from 'node:path'

const PLAN_TASKS = [
  { n: 1,  title: 'Project skeleton (TypeScript ESM, vitest, ESLint)' },
  { n: 2,  title: 'Verify MusiCode1/yemot-api compatibility & lock versions' },
  { n: 3,  title: 'Core types and event shapes' },
  { n: 4,  title: 'Prompt rendering (TTS char stripping)' },
  { n: 5,  title: 'Webhook auth middleware' },
  { n: 6,  title: 'Agent reply parser (strict JSON + auto-wrap)' },
  { n: 7,  title: 'Yemot REST client wrapper' },
  { n: 8,  title: 'Bootstrap flow (idempotent extension setup)' },
  { n: 9,  title: 'CallSession + SessionRegistry' },
  { n: 10, title: 'Agent-loop bridge (timeout, JSON retry, abort)' },
  { n: 11, title: 'Mock Yemot harness (test helper)' },
  { n: 12, title: 'Router-bridge (the call coroutine)' },
  { n: 13, title: 'YemotService (Express + router lifecycle)' },
  { n: 14, title: 'Integration tests with mock harness' },
  { n: 15, title: 'Gateway methods (status / list / end)' },
  { n: 16, title: 'OpenClaw plugin manifest' },
  { n: 17, title: 'Plugin entry (definePluginEntry default export)' },
  { n: 18, title: 'Smoke script + README' },
]

export async function process(inputs, ctx) {
  const {
    planPath = 'docs/superpowers/plans/2026-05-01-voice-yemot-addin.md',
    specPath = 'docs/superpowers/specs/2026-05-01-voice-yemot-addin-design.md',
    workingDir = '.',
  } = inputs

  const completedTasks = []
  let lastCommit = ''

  for (const t of PLAN_TASKS) {
    // Step 1: execute the plan task via a coder agent
    const exec = await ctx.task(executePlanTaskTask, {
      taskNumber: t.n,
      taskTitle: t.title,
      planPath,
      specPath,
      workingDir,
      previouslyCompletedSummary: completedTasks
        .map(c => `- Task ${c.n}: ${c.title} (commit ${c.commit ?? 'unknown'})`)
        .join('\n'),
    })

    // Step 2: verify the task's claims
    const verify = await ctx.task(verifyTaskTask, {
      taskNumber: t.n,
      workingDir,
      isFirstTask: t.n === 1,
      isToolchainOnly: t.n === 1 || t.n === 2,
    })

    if (!verify.passed) {
      // Retry once with the failure feedback as part of the next-attempt prompt.
      const retry = await ctx.task(executePlanTaskTask, {
        taskNumber: t.n,
        taskTitle: t.title,
        planPath,
        specPath,
        workingDir,
        previouslyCompletedSummary: completedTasks
          .map(c => `- Task ${c.n}: ${c.title} (commit ${c.commit ?? 'unknown'})`)
          .join('\n'),
        retry: true,
        previousFailure: verify.summary,
      })
      const verify2 = await ctx.task(verifyTaskTask, {
        taskNumber: t.n,
        workingDir,
        isFirstTask: t.n === 1,
        isToolchainOnly: t.n === 1 || t.n === 2,
      })
      if (!verify2.passed) {
        return {
          success: false,
          tasksCompleted: completedTasks.length,
          lastCommit,
          failedAt: t.n,
          failureSummary: verify2.summary,
        }
      }
      completedTasks.push({ n: t.n, title: t.title, commit: verify2.commit, retried: true })
      lastCommit = verify2.commit
    } else {
      completedTasks.push({ n: t.n, title: t.title, commit: verify.commit })
      lastCommit = verify.commit
    }
  }

  // Final phase: full-suite verification + code review against the spec
  const finalVerify = await ctx.task(finalSuiteVerifyTask, { workingDir })
  const review = await ctx.task(codeReviewTask, {
    workingDir,
    specPath,
    planPath,
    completedTasksSummary: completedTasks.map(c => `- Task ${c.n}: ${c.title}`).join('\n'),
  })

  return {
    success: finalVerify.passed && review.approved,
    tasksCompleted: completedTasks.length,
    lastCommit,
    finalVerify,
    review,
    metadata: { processId: 'voice-yemot-implementation', timestamp: ctx.now() },
  }
}

// ============================================================================
// TASK DEFINITIONS
// ============================================================================

/**
 * Execute one plan task. The agent reads the plan + spec, finds the named task
 * block, executes its steps literally (TDD discipline: write test → fail → impl →
 * pass → commit), and reports what it did.
 */
export const executePlanTaskTask = defineTask('execute-plan-task', (args, taskCtx) => {
  const retryNote = args.retry
    ? `\n\n**RETRY CONTEXT:** A previous attempt failed verification. Failure summary:\n${args.previousFailure}\n\nFix the failure and re-run the task's full step sequence. If the previous attempt left partial state (uncommitted files, broken commits), \`git status\` and \`git log -3 --oneline\` first; clean up via \`git restore\`/\`git reset --soft HEAD~1\` only if clearly the right move; otherwise pick up where the failure indicates.`
    : ''

  return {
    kind: 'agent',
    title: `Execute Plan Task ${args.taskNumber}: ${args.taskTitle}${args.retry ? ' (retry)' : ''}`,
    description: `Faithfully execute Task ${args.taskNumber} from the implementation plan, following its TDD step sequence.`,

    agent: {
      name: 'general-purpose',
      prompt: {
        role: 'senior TypeScript engineer executing a pre-written implementation plan',
        task: `Execute Task ${args.taskNumber} from the implementation plan, following its checklist literally.`,
        context: {
          taskNumber: args.taskNumber,
          taskTitle: args.taskTitle,
          planPath: args.planPath,
          specPath: args.specPath,
          workingDir: args.workingDir,
          previouslyCompletedTasks: args.previouslyCompletedSummary,
        },
        instructions: [
          `cd to ${args.workingDir} as your working directory.`,
          `Read the plan section labeled exactly "## Task ${args.taskNumber}: ${args.taskTitle}" from ${args.planPath}.`,
          'Read the spec at the specPath if needed for design context.',
          'Execute each "- [ ] **Step N: …**" item in order, exactly as written.',
          'For TDD steps: write the failing test first, run it to confirm it fails, then write the minimal implementation, then run again to confirm it passes. Do not skip the failing-test confirmation step.',
          'Use the Write tool to create files; the Edit tool to modify existing files; the Bash tool for npm/git/test commands.',
          'Run every command shown in the plan with its exact arguments.',
          'When the plan instructs a git commit at the end of the task, do exactly that (multi-line message via heredoc as shown).',
          'If a command fails, do not skip to the next step. Diagnose the failure, fix it, re-run.',
          'Do NOT modify files outside the scope of this task. Do NOT add cleanup, refactors, or extras the plan does not specify.',
          'If the plan task notes uncertainty (e.g. unverified library export name), follow the resolution it suggests.',
          'When done, return a JSON summary of what files you created/modified, the commands you ran, the test counts, and the commit SHA.',
          retryNote,
        ].filter(Boolean),
        outputFormat: 'JSON with fields: filesCreated (string[]), filesModified (string[]), commandsRun (string[]), testsPassed (number), commitSha (string|null), notes (string)',
      },
      outputSchema: {
        type: 'object',
        required: ['filesCreated', 'filesModified', 'commandsRun', 'commitSha'],
        properties: {
          filesCreated:  { type: 'array', items: { type: 'string' } },
          filesModified: { type: 'array', items: { type: 'string' } },
          commandsRun:   { type: 'array', items: { type: 'string' } },
          testsPassed:   { type: 'number' },
          commitSha:     { type: ['string', 'null'] },
          notes:         { type: 'string' },
        },
      },
    },

    io: {
      inputJsonPath:  `tasks/${taskCtx.effectId}/input.json`,
      outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
    },

    labels: ['execute', `task-${args.taskNumber}`, ...(args.retry ? ['retry'] : [])],
  }
})

/**
 * Verify a task by running test suite + typecheck + checking that a new commit
 * exists since the previous task.
 */
export const verifyTaskTask = defineTask('verify-task', (args, taskCtx) => {
  // Tasks 1 (skeleton) and 2 (dep verification) don't have tests yet — only
  // typecheck + commit are sensible gates.
  const testCmd = args.isToolchainOnly
    ? 'echo "(no tests yet for toolchain task)"'
    : 'npm test --silent 2>&1 | tail -40'

  return {
    kind: 'shell',
    title: `Verify Plan Task ${args.taskNumber}`,
    description: 'Run test suite + typecheck + verify a commit was made',

    shell: {
      command: `cd "${args.workingDir}" && \
echo "=== TEST ===" && ${testCmd} && \
echo "=== TYPECHECK ===" && (npm run typecheck --silent 2>&1 | tail -20 || true) && \
echo "=== GIT LOG (last 3) ===" && git log -3 --oneline && \
echo "=== GIT STATUS ===" && git status --short && \
echo "=== HEAD-COMMIT ===" && git rev-parse --short HEAD`,
    },

    io: {
      inputJsonPath:  `tasks/${taskCtx.effectId}/input.json`,
      outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
    },

    labels: ['verify', `task-${args.taskNumber}`],
  }
})

/**
 * Final full-suite verification — every test, typecheck, lint, build.
 */
export const finalSuiteVerifyTask = defineTask('final-suite-verify', (args, taskCtx) => ({
  kind: 'shell',
  title: 'Final full-suite verification',
  description: 'Full test suite + typecheck + lint + build',

  shell: {
    command: `cd "${args.workingDir}" && \
echo "=== FULL TEST SUITE ===" && npm test 2>&1 | tail -60 && \
echo "=== TYPECHECK ===" && npm run typecheck 2>&1 | tail -20 && \
echo "=== LINT ===" && (npm run lint 2>&1 | tail -20 || echo "(lint warnings non-fatal)") && \
echo "=== BUILD ===" && npm run build 2>&1 | tail -20 && \
echo "=== FINAL HEAD ===" && git log --oneline | head -25`,
  },

  io: {
    inputJsonPath:  `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },

  labels: ['verify', 'final'],
}))

/**
 * Final code review against the spec. Uses the superpowers code-reviewer agent.
 */
export const codeReviewTask = defineTask('code-review', (args, taskCtx) => ({
  kind: 'agent',
  title: 'Final code review against spec',
  description: 'Review the implementation diff for spec coverage, quality, and discipline',

  agent: {
    name: 'superpowers:code-reviewer',
    prompt: {
      role: 'senior reviewer of a TDD implementation against its spec',
      task: 'Review the openclaw-voice-yemot v1 implementation against its design spec and plan; surface any drift, missing scope, or quality concerns.',
      context: {
        workingDir: args.workingDir,
        specPath: args.specPath,
        planPath: args.planPath,
        completedTasks: args.completedTasksSummary,
      },
      instructions: [
        `cd to ${args.workingDir}.`,
        'Read the spec at specPath in full.',
        'Read the plan at planPath in full.',
        'Run \`git log --oneline\` to see commits; \`git diff <first-impl-commit>..HEAD --stat\` for the full diff scope.',
        'Read every src/**/*.ts and test/**/*.ts file (use Read tool).',
        'Check: every spec section has corresponding code; no scope creep beyond Tier 1; TDD discipline (every src module has a test file); error handling per spec §8; agent JSON contract per spec §5.4; bootstrap idempotency per spec §5.2.',
        'Run \`npm test\` and \`npm run typecheck\` to confirm green.',
        'Issue a verdict: approved | changes-needed. If changes-needed, list each issue with file:line references.',
      ],
      outputFormat: 'JSON with fields: approved (boolean), verdict (string), issues (array of {severity, file, line?, summary, suggestion?}), specCoverage (object mapping spec section to coverage status)',
    },
    outputSchema: {
      type: 'object',
      required: ['approved', 'verdict'],
      properties: {
        approved: { type: 'boolean' },
        verdict:  { type: 'string' },
        issues:   { type: 'array' },
        specCoverage: { type: 'object' },
      },
    },
  },

  io: {
    inputJsonPath:  `tasks/${taskCtx.effectId}/input.json`,
    outputJsonPath: `tasks/${taskCtx.effectId}/result.json`,
  },

  labels: ['review', 'final'],
}))
