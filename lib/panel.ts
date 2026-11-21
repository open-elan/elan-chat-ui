/**
 * The Details panel's sections open ONE AT A TIME.
 *
 * Every section — Statement, About this agent, Action settings, Connected
 * accounts, Your keys — is a `<details>` carrying this `name`, and the browser
 * treats `<details>` that share a name as an exclusive accordion: opening one
 * closes whichever was open. No state, no handlers, and it still works with
 * the keyboard. Spelled once, because a section that misspells it simply
 * stops taking part — silently, with both open at once.
 */
export const SECTION = "details-section";
