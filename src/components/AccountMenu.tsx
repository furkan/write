import { colorFor, initialOf } from '../identity'
import { accountAction, useMe } from '../session'
import { Dropdown, MenuItem } from './Dropdown'

/** Header menu with the signed-in email and the account action. */
export function AccountMenu() {
  const me = useMe()
  const action = accountAction(me)
  return (
    <Dropdown
      label={
        <span className="account-avatar" style={{ background: colorFor(me.email) }} aria-hidden>
          {initialOf(me.email)}
        </span>
      }
      title={`Account: ${me.email}`}
      tour="account"
      align="end"
      className="account"
    >
      {(close) => (
        <>
          <div className="account-info">
            <span className="muted small">Signed in as</span>
            <strong className="account-email" data-testid="account-email">
              {me.email}
            </strong>
            {me.mode === 'dev' && <span className="muted small">Dev mode: no sign-in, anyone can switch user.</span>}
          </div>
          <hr />
          <MenuItem
            onSelect={() => {
              close()
              action.run()
            }}
          >
            {action.label}
          </MenuItem>
        </>
      )}
    </Dropdown>
  )
}
