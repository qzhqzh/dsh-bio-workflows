import { useCallback, useSyncExternalStore } from 'react'

import { WorkflowCenter } from './WorkflowCenter.tsx'
import { DraftGraphToolView } from './WorkflowGraphView.tsx'
import { RunListToolView, RunResultToolView } from './RunResultView.tsx'
import { WorkflowIcon } from './icons.tsx'
import { STYLE } from './styles.ts'
import type { ClientPluginContext, SessionsFace, SlotsFace } from './types.ts'

export const inject = ['slots', 'sessions']

function installStyles() {
  if (document.getElementById('dsh-bio-workflows-style') !== null) return
  const style = document.createElement('style')
  style.id = 'dsh-bio-workflows-style'
  style.dataset.plugin = 'dsh-bio-workflows'
  style.textContent = STYLE
  document.head.append(style)
}

function createOpenState() {
  let open = false
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => open,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next: boolean) {
      if (next === open) return
      open = next
      for (const listener of listeners) listener()
    },
  }
}

export function apply(ctx: ClientPluginContext) {
  installStyles()
  const slots = ctx.get('slots') as SlotsFace | undefined
  const sessions = ctx.get('sessions') as SessionsFace | undefined
  if (!slots || !sessions) return
  const state = createOpenState()

  slots.inject('shell.overlay', () => slots.register(
    { name: 'shell.overlay', id: 'bio-workflows-center' },
    function WorkflowCenterOverlay() {
      const open = useSyncExternalStore(state.subscribe, state.getSnapshot)
      const close = useCallback(() => { state.set(false) }, [])
      return <WorkflowCenter sessions={sessions} open={open} onClose={close} />
    },
  ))

  slots.inject('sidebar.footer.action', () => slots.register(
    { name: 'sidebar.footer.action', id: 'bio-workflows-center', order: 220 },
    function WorkflowCenterAction({ wide }: { wide: boolean }) {
      const open = useSyncExternalStore(state.subscribe, state.getSnapshot)
      return (
        <button
          type="button"
          className="dsh-bio-sidebar-action"
          data-open={open || undefined}
          data-rail={!wide || undefined}
          aria-expanded={open}
          aria-label="Bio Workflows"
          title="Open Bio Workflows"
          onClick={() => { state.set(!open) }}
        >
          <WorkflowIcon />{wide && <span>Bio Workflows</span>}
        </button>
      )
    },
  ))

  slots.inject('tool.call.toolview', () => slots.register(
    { name: 'tool.call.toolview', key: 'bio_workflows_draft_graph' },
    DraftGraphToolView,
  ))
  slots.inject('tool.call.toolview', () => slots.register(
    { name: 'tool.call.toolview', key: 'bio_workflows_run_list' },
    RunListToolView,
  ))
  slots.inject('tool.call.toolview', () => slots.register(
    { name: 'tool.call.toolview', key: 'bio_workflows_run_get' },
    RunResultToolView,
  ))
}

export { WorkflowCenter } from './WorkflowCenter.tsx'
export { DraftGraphToolView, WorkflowGraphView } from './WorkflowGraphView.tsx'
export { RunListToolView, RunResultToolView } from './RunResultView.tsx'
export { projectRunGetToolResult, projectRunListToolResult } from './run-result.ts'
export { layoutWorkflowGraph } from './graph-layout.ts'
export type { WorkflowCenterBootstrap, WorkflowGraph } from './types.ts'
