/** A sign-in window's size: a provider's consent page, not a whole site. */
const SIGN_IN_WINDOW = { width: 520, height: 720 };

/**
 * Open a small window for a provider's sign-in, centred over this one.
 *
 * CALL IT INSIDE THE CLICK, before anything is awaited: a popup blocker allows
 * a window the click itself opened and blocks one opened after a fetch. Point
 * it at the sign-in once the ticket arrives; the platform's completion page
 * closes it.
 *
 * NAMED, so a second click reuses the same window rather than stacking another.
 */
export function openSignInWindow(): Window | null {
  const { width, height } = SIGN_IN_WINDOW;
  const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - height) / 3);
  return window.open(
    "about:blank",
    "connect-sign-in",
    `popup,width=${width},height=${height},left=${left},top=${top}`,
  );
}
