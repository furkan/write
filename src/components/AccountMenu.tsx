import { accountAction, useMe } from '../session'
import { Avatar } from './Avatar'
import { Dropdown } from './Dropdown'

/**
 * Header popover with the signed-in email and the account action. A disclosure rather than a
 * menu, because it holds text as well as a button; the email is also in the button's name.
 */
export function AccountMenu() {
  const me = useMe()
  const action = accountAction(me)
  return (
    <Dropdown label={<Avatar email={me.email} />} title={`Account: ${me.email}`} tour="account" align="end" className="account" kind="disclosure">
      {(close) => (
        <>
          <p className="account-info">
            <span className="muted small">Signed in as</span>
            <strong className="account-email" data-testid="account-email">
              {me.email}
            </strong>
            {me.mode === 'dev' && <span className="muted small">Dev mode: no sign-in, anyone can switch user.</span>}
          </p>
          <hr />
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              close()
              action.run()
            }}
          >
            {action.label}
          </button>
        </>
      )}
    </Dropdown>
  )
}
