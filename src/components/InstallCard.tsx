import { installApp, useInstall } from '../lib/install';
import { Icon } from './Icon';
import { toast } from './ui';

/** Settings card: install the site as a phone app (Chrome makes it a real Android app). */
export function InstallCard() {
  const state = useInstall();
  return (
    <div className="card ai-settings" id="app">
      <h2>
        <Icon name="download" /> Phone app
      </h2>
      {state === 'app' ? (
        <p className="tf-status">
          <Icon name="check" size={18} />
          <span>
            <b>You're using Vocab as an app.</b>
            <small className="muted">Same words and progress as in the browser on this phone.</small>
          </span>
        </p>
      ) : (
        <>
          <p className="muted small">
            Put Vocab on your home screen: it opens full screen like any other app, works offline, and keeps the same words and progress as here. No app store needed.
          </p>
          {state === 'installed' ? (
            <p className="small">
              <Icon name="check" size={16} /> Installed. Open Vocab from your home screen.
            </p>
          ) : state === 'ready' ? (
            <div className="row">
              <button
                type="button"
                className="primary"
                onClick={async () => {
                  if (!(await installApp())) toast('Use the browser menu: ⋮ → Install app', 'info');
                }}
              >
                <Icon name="download" /> Install the app
              </button>
            </div>
          ) : (
            <ul className="small install-steps">
              <li>
                <b>Android (Chrome):</b> tap ⋮ at the top right, then <b>Install app</b> (or <b>Add to home screen</b> → Install).
              </li>
              <li>
                <b>iPhone (Safari):</b> tap Share, then <b>Add to Home Screen</b>.
              </li>
              <li>
                <b>Computer (Chrome or Edge):</b> click the install icon at the right of the address bar.
              </li>
            </ul>
          )}
        </>
      )}
    </div>
  );
}
