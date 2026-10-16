import type { ReactNode } from 'react'

// On phones the app already fills the screen; the website version (see
// WebFrame.web.tsx) centres it on wide screens.
export function WebFrame({ children }: { children: ReactNode }) {
  return <>{children}</>
}
