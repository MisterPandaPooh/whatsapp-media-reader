import { useEffect, useState } from 'react'
import { readMediaFile } from '../../storage/fileAccess'
import type { StorageRef } from '../../types'

/**
 * Object URL for one media file, revoked when the file changes or the component
 * unmounts. Returns `null` while loading and for anything that cannot be read —
 * `readMediaFile` answers `null` rather than throwing for a file that is absent
 * from the export or has been evicted, so callers only ever need the one branch.
 *
 * `enabled` exists so a caller can keep hook order stable while declining to
 * read anything (a document, a link, a missing file). Passing `false` also
 * releases a URL that was loaded before the item changed.
 */
export function useMediaObjectUrl(
  ref: StorageRef | undefined,
  filename: string,
  enabled: boolean,
): string | null {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled || !ref) {
      setUrl(null)
      return
    }
    // `stale` guards the async resolve: without it, two quick item changes can
    // land out of order and leave the second URL overwritten by the first — and
    // then never revoked, because cleanup only knows about the one it created.
    let stale = false
    let created: string | null = null

    void readMediaFile(ref, filename).then((file) => {
      if (stale || !file) return
      created = URL.createObjectURL(file)
      setUrl(created)
    })

    return () => {
      stale = true
      setUrl(null)
      if (created) URL.revokeObjectURL(created)
    }
  }, [ref, filename, enabled])

  return url
}
