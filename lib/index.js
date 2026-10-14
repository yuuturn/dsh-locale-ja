/**
 * Host half of the `dsh-locale-ja` language pack.
 *
 * The pack is a browser-side concern: it registers the `ja` language and its
 * dictionaries through the client half (`lib/client.js`). The empty `apply`
 * keeps the optional browser feature addressable from the host-owned Loader
 * composition, exactly like the shipped dual-face packages.
 */

/** Host plugin body — Japanese locale behavior exists only in the browser entry. */
export function apply() {}
