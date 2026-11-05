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
    <div className="loading deleted" role={role}>
      <p className="deleted-title">{title}</p>
      {children && <p className="muted closed-text">{children}</p>}
      {actions && <div className="closed-actions">{actions}</div>}
    </div>
  )
}
