import { QueryClient } from '@tanstack/react-query'
import { clearToken } from './api'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status
        if (status === 401) return false
        return failureCount < 2
      },
      refetchIntervalInBackground: false,
    },
    mutations: { retry: false },
  },
})

// Global 401 handler: clear token and reload to TokenGate
queryClient.getQueryCache().subscribe(event => {
  if (event.type === 'observerResultsUpdated') {
    const status = (event.query.state.error as { status?: number } | null)?.status
    if (status === 401) {
      clearToken()
      window.location.reload()
    }
  }
})
