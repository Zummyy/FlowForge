// Cap on ACTIVE versions per track. When a save would exceed it, the OLDEST
// active versions are moved to the archive (archivedAt set, never hard-
// deleted) so the editor keeps a sane working set while nothing is lost.
// Archived versions stay queryable, restorable and purgeable.
//
// Lives outside the "use server" action file on purpose: Next.js only allows
// async function exports there, and the Vault page (a client component) needs
// this value to render the quota chip.
export const MAX_ACTIVE_VERSIONS_PER_LYRIC = 50;
