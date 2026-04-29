import { useState } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/queryClient'
import { TokenGate } from '@/components/TokenGate'
import { TasksTab } from '@/tabs/TasksTab'
import { AuditTab } from '@/tabs/AuditTab'
import { CostTab } from '@/tabs/CostTab'
import { KnowledgeTab } from '@/tabs/KnowledgeTab'

type Tab = 'tasks' | 'audit' | 'cost' | 'knowledge'

const TABS: { id: Tab; label: string }[] = [
  { id: 'tasks', label: 'Tasks' },
  { id: 'audit', label: 'Audit' },
  { id: 'cost', label: 'Cost' },
  { id: 'knowledge', label: 'Knowledge' },
]

function Dashboard() {
  const [tab, setTab] = useState<Tab>('tasks')

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm tracking-tight">gijun-ai</span>
          <nav className="flex gap-1">
            {TABS.map(t => (
              <button key={t.id} type="button" onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  tab === t.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6">
        {tab === 'tasks' && <TasksTab />}
        {tab === 'audit' && <AuditTab />}
        {tab === 'cost' && <CostTab />}
        {tab === 'knowledge' && <KnowledgeTab />}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TokenGate>
        <Dashboard />
      </TokenGate>
    </QueryClientProvider>
  )
}
