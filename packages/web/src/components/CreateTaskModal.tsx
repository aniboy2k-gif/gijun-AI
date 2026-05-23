import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, type CreateTaskInput } from '@/lib/api'
import { AlertTriangle, X } from 'lucide-react'

interface CreateTaskModalProps {
  onClose: () => void
}

type Complexity = 'trivial' | 'standard' | 'complex' | 'critical'
type ActionType = 'read' | 'write' | 'execute' | 'delete'

const COMPLEXITY_LABELS: Record<Complexity, string> = {
  trivial: 'trivial — 단순',
  standard: 'standard — 표준',
  complex: 'complex — 복잡',
  critical: 'critical — 임계 (HITL 자동)',
}

export function CreateTaskModal({ onClose }: CreateTaskModalProps) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [complexity, setComplexity] = useState<Complexity>('standard')
  const [description, setDescription] = useState('')
  const [project, setProject] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [toolName, setToolName] = useState('')
  const [actionType, setActionType] = useState<'' | ActionType>('')
  const [resource, setResource] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)

  const isDirty = (): boolean =>
    title.trim() !== '' ||
    description.trim() !== '' ||
    project.trim() !== '' ||
    tagsInput.trim() !== '' ||
    toolName.trim() !== '' ||
    actionType !== '' ||
    resource.trim() !== ''

  const requestClose = (): void => {
    if (isDirty() && !confirm('입력 내용이 있습니다. 닫으시겠습니까?')) return
    onClose()
  }

  // Autofocus title on mount
  useEffect(() => {
    titleRef.current?.focus()
  }, [])

  // ESC close
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') requestClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, description, project, tagsInput, toolName, actionType, resource])

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) requestClose()
  }

  const parseTags = (): string[] =>
    tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0)

  const validate = (): string | null => {
    const t = title.trim()
    if (t.length === 0) return '제목을 입력해주세요.'
    if (t.length > 200) return '제목은 200자 이하여야 합니다.'
    if (description.length > 4096) return '설명은 4096자 이하여야 합니다.'
    if (parseTags().length > 5) return '태그는 최대 5개입니다.'

    const trio = [toolName.trim(), actionType, resource.trim()]
    const trioFilled = trio.filter(v => v !== '').length
    if (trioFilled !== 0 && trioFilled !== 3) {
      return 'HITL 평가 필드 (toolName · actionType · resource)는 셋 다 채우거나 모두 비워야 합니다.'
    }
    return null
  }

  const createMutation = useMutation({
    mutationFn: api.createTask,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      onClose()
    },
  })

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    const err = validate()
    if (err !== null) {
      setFormError(err)
      return
    }
    setFormError(null)

    const input: CreateTaskInput = { title: title.trim(), complexity }
    if (description.trim() !== '') input.description = description.trim()
    if (project.trim() !== '') input.project = project.trim()
    const tags = parseTags()
    if (tags.length > 0) input.tags = tags
    if (toolName.trim() !== '' && actionType !== '' && resource.trim() !== '') {
      input.toolName = toolName.trim()
      input.actionType = actionType
      input.resource = resource.trim()
    }
    createMutation.mutate(input)
  }

  const submitError = createMutation.isError
    ? (createMutation.error as Error).message
    : null

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is mouse-only; ESC closes via document-level handler.
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-task-title"
    >
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-4 p-6 border border-border rounded-xl bg-card shadow-xl">
        <div className="flex items-center justify-between">
          <h2 id="create-task-title" className="text-base font-semibold">
            새 작업 만들기
          </h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="닫기"
            className="p-1 rounded hover:bg-accent"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="task-title" className="text-xs font-medium text-muted-foreground">
              제목 <span className="text-red-600">*</span>
            </label>
            <input
              id="task-title"
              ref={titleRef}
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={200}
              className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="작업 제목 (1~200자)"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="task-complexity" className="text-xs font-medium text-muted-foreground">
              복잡도
            </label>
            <select
              id="task-complexity"
              value={complexity}
              onChange={e => setComplexity(e.target.value as Complexity)}
              className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {(Object.entries(COMPLEXITY_LABELS) as [Complexity, string][]).map(
                ([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ),
              )}
            </select>
          </div>

          {complexity === 'critical' && (
            <div className="flex items-start gap-2 p-3 border border-orange-300 bg-orange-50 rounded">
              <AlertTriangle size={14} className="text-orange-700 shrink-0 mt-0.5" />
              <p className="text-xs text-orange-900">
                HITL이 자동 발동됩니다. 작업은 <code className="font-mono">hitl_required=1</code> 상태로 생성되며,
                Tasks 탭에서 승인하실 때까지 대기합니다.
              </p>
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor="task-description" className="text-xs font-medium text-muted-foreground">
              설명 (선택)
            </label>
            <textarea
              id="task-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              maxLength={4096}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
              placeholder="작업 설명 (최대 4096자)"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="task-project" className="text-xs font-medium text-muted-foreground">
              프로젝트 (선택)
            </label>
            <input
              id="task-project"
              type="text"
              value={project}
              onChange={e => setProject(e.target.value)}
              maxLength={128}
              className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="예: gijun-ai"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="task-tags" className="text-xs font-medium text-muted-foreground">
              태그 (선택 — 콤마 분리, 최대 5)
            </label>
            <input
              id="task-tags"
              type="text"
              value={tagsInput}
              onChange={e => setTagsInput(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="예: feat, ui"
            />
          </div>

          <details className="border border-border rounded-md">
            <summary className="px-3 py-2 text-xs font-medium text-muted-foreground cursor-pointer select-none">
              HITL 평가 정보 (선택 — 셋 다 채우거나 모두 비움)
            </summary>
            <div className="p-3 space-y-3 border-t border-border">
              <div className="space-y-1">
                <label htmlFor="task-toolname" className="text-xs text-muted-foreground">
                  toolName
                </label>
                <input
                  id="task-toolname"
                  type="text"
                  value={toolName}
                  onChange={e => setToolName(e.target.value)}
                  maxLength={128}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="예: bash"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="task-action" className="text-xs text-muted-foreground">
                  actionType
                </label>
                <select
                  id="task-action"
                  value={actionType}
                  onChange={e => setActionType(e.target.value as '' | ActionType)}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">(선택)</option>
                  <option value="read">read</option>
                  <option value="write">write</option>
                  <option value="execute">execute</option>
                  <option value="delete">delete</option>
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="task-resource" className="text-xs text-muted-foreground">
                  resource
                </label>
                <input
                  id="task-resource"
                  type="text"
                  value={resource}
                  onChange={e => setResource(e.target.value)}
                  maxLength={512}
                  className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="예: /etc/passwd"
                />
              </div>
            </div>
          </details>

          {formError !== null && (
            <p className="text-xs text-red-600">{formError}</p>
          )}
          {submitError !== null && (
            <p className="text-xs text-red-600">생성 실패: {submitError}</p>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={requestClose}
              disabled={createMutation.isPending}
              className="px-3 py-1.5 text-sm border border-border rounded hover:bg-accent disabled:opacity-40"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-40"
            >
              {createMutation.isPending ? '생성 중…' : '생성'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
