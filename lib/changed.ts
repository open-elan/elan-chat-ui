/**
 * One event name, so the two surfaces that show a permission agree.
 *
 * A standing grant is made on the approval CARD and displayed in Action
 * SETTINGS, which are different components with their own state. Without this
 * somebody presses "always approve", opens settings, and finds it still saying
 * "as the agent ships" — the grant is real and the page is stale, which is the
 * reading most likely to be mistaken for the bug this panel exists to rule out.
 *
 * A WINDOW EVENT RATHER THAN SHARED STATE because it crosses two unrelated
 * branches of the tree for one rare moment; lifting the state would couple the
 * rail to the transcript permanently to avoid a refetch that costs nothing.
 */
export const PERMISSIONS_CHANGED = "elan:permissions-changed";

export function permissionsChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PERMISSIONS_CHANGED));
  }
}
