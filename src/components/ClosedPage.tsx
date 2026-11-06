import type { ReactNode } from 'react'

type ClosedPageProps = {
  title: string
  children?: ReactNode
  /** Buttons or links, laid out in a row. */
  actions?: ReactNode
  /** `alert` for something that went wrong, `status` for good news. */
  role?: 'alert' | 'status'
}

/** A full-page message instead of the document or library: no access, trashed, signed out… */
export function ClosedPage({ title, children, actions, role = 'alert' }: ClosedPageProps) {
  return (
    <main>
      <div className="loading deleted" role={role}>
        <h1 className="deleted-title">{title}</h1>
        {children && <p className="muted closed-text">{children}</p>}
        {actions && <div className="closed-actions">{actions}</div>}
      </div>
    </main>
  )
}
