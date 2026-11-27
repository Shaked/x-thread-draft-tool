import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { draftsApi, authApi } from '../utils/api'
import { useDraftLive, updatedLabel } from '../utils/useDraftLive'
import { useViewAs, viewAsReason } from '../utils/viewAs'
import { uploadsPending } from '../utils/pendingUploads'
import { normalizeImages } from '../utils/images'
import { set as storeSet, del as idbDel, get as idbGet } from 'idb-keyval'
import ThreadComposer from '../components/ThreadComposer'
import LiveStatus from '../components/LiveStatus'
import AgentLinkButton from '../components/AgentLinkButton'
import XThreadLinkButton from '../components/XThreadLinkButton'
import ShareLinkButton from '../components/ShareLinkButton'
import ExportOptions from '../components/ExportOptions'
import { useToast } from '../ui/Toast'
import { useConfirm } from '../ui/Dialog'
import Badge from '../ui/Badge'
import Banner from '../ui/Banner'
import Button from '../ui/Button'
import Input from '../ui/Input'
import { idsFromTheirs, mergeDraftEdits } from '../utils/draftMerge'
import PageHeader from '../ui/PageHeader'
import Stack from '../ui/Stack'
import Page from '../ui/Page'
import Skeleton from '../ui/Skeleton'

// A post saved before ids were required has none. An object without a string id gets a new one, so
// the next save is accepted. Anything else is returned as it is, so the server still refuses it.
const withPostId = post =>
  post !== null && typeof post === 'object' && !Array.isArray(post) && typeof post.id !== 'string'
    ? { ...post, id: crypto.randomUUID() }
    : post

// The draft as the editor holds it: images normalized for backward compatibility.
const normalizeDraft = data => ({
  ...data,
  posts: data.posts?.map(post => ({
    ...withPostId(post),
    images: normalizeImages(post.images || [])
  })) || []
})

// My text from a conflict, kept in this browser until I copy it or keep mine. The `draft-` prefix means sign-out clears it.
const mineKeyOf = id => `draft-${id}-mine`

// The kept text, or null. Never throws: a blocked IndexedDB must not block the editor.
const readKeptText = async id => {
  try {
    const kept = await idbGet(mineKeyOf(id))
    return typeof kept === 'string' ? kept : null
  } catch {
    return null
  }
}

// The text the user wrote, one post per paragraph, for copying after a conflict.
const plainText = draft => [draft.title, ...draft.posts.map(post => post.text)].filter(Boolean).join('\n\n')

export default function DraftEditor({ user }) {
  const viewAs = useViewAs()
  const reason = viewAsReason(viewAs)
  // While viewing as a user nothing of theirs is written to this browser (#291): no cache, no kept text, no autosave.
  const idbSet = useCallback((key, value) => (viewAs ? Promise.resolve() : storeSet(key, value)), [viewAs])
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const ask = useConfirm()

  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [synced, setSynced] = useState(true)
  // True after a save gets 401: the session ended. The text stays in the editor for the user to copy.
  const [signedOut, setSignedOut] = useState(false)
  // Set after a save gets 412: another app changed the draft. { version, theirs } until the user chooses.
  const [conflict, setConflict] = useState(null)
  // After "Show their changes": my text, for copying.
  const [copyText, setCopyText] = useState(null)

  const saveTimeoutRef = useRef(null)
  const lastSavedRef = useRef(null)
  // The version the editor last read or saved. Every save sends it as If-Match.
  const versionRef = useRef(undefined)
  // Mirrors `conflict`, so a save started in the same tick sees it at once. No save runs while it is set.
  const conflictRef = useRef(false)
  // The copy box's text (null when closed). A ref too, so the unload guard and saves read it at once.
  const copyTextRef = useRef(null)
  const setCopy = text => {
    copyTextRef.current = text
    setCopyText(text)
  }
  // The text to keep for me: the copy box's text (if still open) followed by the current text, not replacing it.
  const keptFor = current => {
    const previous = copyTextRef.current
    return previous && previous !== current ? `${previous}\n\n---\n\n${current}` : current
  }
  // #474: a 412 where the other app changed other posts is merged, then saved once. Counts the merges, so a save queued
  // before one (it holds text from before the merge) never runs after it. The flag is set until the merged save works:
  // a 412 of that save shows the banner, never a second merge.
  const mergeEpochRef = useRef(0)
  const mergedPendingRef = useRef(false)
  const [mergeNoteAt, setMergeNoteAt] = useState(null)
  const mergeRef = useRef(null)
  // Saves run one at a time, so a save never sends the version an earlier save of this editor just replaced.
  const saveChainRef = useRef(Promise.resolve())
  // Saves in flight (the live check waits for none). The draft as last rendered (the live check compares it).
  const savingCountRef = useRef(0)
  const draftRef = useRef(null)
  useEffect(() => {
    draftRef.current = draft
  })
  // Live updates (#363): the posts another app changed, highlighted for a moment, and when they arrived.
  const [highlighted, setHighlighted] = useState([])
  const [updatedAt, setUpdatedAt] = useState(null)
  const [clock, setClock] = useState(() => Date.now())

  const loadDraft = async () => {
    try {
      setLoading(true)
      setError(null)

      // The server returns a draft only to its owner: 401 when signed out, 404 for anyone else.
      const data = await draftsApi.get(id)

      const normalizedData = normalizeDraft(data)

      setDraft(normalizedData)
      lastSavedRef.current = JSON.stringify(normalizedData)
      versionRef.current = data.version

      // Save to IndexedDB for offline access
      await idbSet(`draft-${id}`, data)

      // My text from an earlier conflict, kept in this browser: show it to copy, unless it is the server's text.
      const kept = await readKeptText(id)
      if (kept !== null && kept !== plainText(normalizedData)) {
        setCopy(kept)
      }
    } catch (err) {
      console.error('Error loading draft:', err)
      // A copy kept in this browser must never show for a draft the server refuses.
      if (err.status === 401 || err.status === 404) {
        await idbDel(`draft-${id}`).catch(() => {})
      }
      setError({ status: err.status, message: err.message || 'Failed to load draft' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the spinner resets when the draft id changes
    loadDraft()
  }, [id, user])

  // The merge of #474: my copy and the other app's copy changed different posts. Returns false when they did not
  // (the banner shows then). On true the merged draft is in the editor and the next autosave sends it, with their version.
  const mergeAfter412 = err => {
    const version = err.version ?? err.draft?.version
    const mine = draftRef.current
    // An upload in flight writes its result from the draft it started with: a merge now would be undone by it (the banner shows).
    if (uploadsPending() || mergedPendingRef.current || !mine || !err.draft || !Number.isInteger(version) || !(version > versionRef.current)) return false
    const base = JSON.parse(lastSavedRef.current)
    const theirs = normalizeDraft(err.draft)
    const merged = mergeDraftEdits(base, mine, theirs)
    if (!merged) return false
    mergeEpochRef.current += 1
    versionRef.current = version
    lastSavedRef.current = JSON.stringify(theirs)
    const changesToSave = JSON.stringify(merged) !== lastSavedRef.current
    mergedPendingRef.current = changesToSave
    // My text stays in this browser until the merged save works.
    if (changesToSave) idbSet(mineKeyOf(id), keptFor(plainText(mine))).catch(() => {})
    setDraft(merged)
    idbSet(`draft-${id}`, err.draft).catch(() => {})
    setHighlighted(idsFromTheirs(base, theirs, merged))
    setMergeNoteAt(Date.now())
    if (!changesToSave) setSynced(true)
    return true
  }

  useEffect(() => {
    mergeRef.current = mergeAfter412
  })

  const saveDraft = useCallback(
    async (draftToSave, immediate = false, keepalive = false) => {
      // No save while another app's change is waiting for the user's choice.
      if (!user || viewAs || conflictRef.current) return false

      const epochAtCall = mergeEpochRef.current
      const enqueue = fn => {
        const run = saveChainRef.current.then(fn)
        saveChainRef.current = run.catch(() => {})
        return run
      }

      const saveFn = async () => {
        // A save queued before a conflict must not send anything once the conflict is open.
        if (conflictRef.current) return false
        if (epochAtCall !== mergeEpochRef.current) return false
        savingCountRef.current += 1
        try {
          setSaving(true)
          setSynced(false)

          const saved = await draftsApi.update(
            id,
            { title: draftToSave.title, posts: draftToSave.posts },
            versionRef.current,
            { keepalive }
          )
          versionRef.current = saved?.version ?? versionRef.current
          mergedPendingRef.current = false

          lastSavedRef.current = JSON.stringify(draftToSave)
          setSynced(true)
          setSignedOut(false)

          // Update IndexedDB. A kept copy of my text goes once the copy box is closed.
          if (copyTextRef.current === null) await idbDel(mineKeyOf(id)).catch(() => {})
          await idbSet(`draft-${id}`, draftToSave)
          return true
        } catch (err) {
          console.error('Save error:', err)
          if (err.status === 412) {
            // Nothing was written. Another app changed other posts: merge and save once (#474).
            if (mergeRef.current?.(err)) return false
            mergedPendingRef.current = false
            // Otherwise stop saving and let the user choose (see the banner).
            conflictRef.current = true
            setConflict({ version: err.version ?? err.draft?.version, theirs: err.draft })
            idbSet(mineKeyOf(id), keptFor(plainText(draftToSave))).catch(() => {})
            setSynced(true)
            return false
          }
          // Still save to IndexedDB even if server fails, except when signed out (sign-out clears this cache)
          if (err.status === 401) setSignedOut(true)
          else await idbSet(`draft-${id}`, draftToSave)
          return false
        } finally {
          savingCountRef.current -= 1
          setSaving(false)
        }
      }

      if (immediate) {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
        }
        return enqueue(saveFn)
      } else {
        // Debounce
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current)
        }
        saveTimeoutRef.current = setTimeout(() => enqueue(saveFn), 1000)
      }
    },
    [id, user, viewAs, idbSet]
  )

  useEffect(() => {
    if (mergeNoteAt === null) return undefined
    const timer = setTimeout(() => setMergeNoteAt(null), 6000)
    return () => clearTimeout(timer)
  }, [mergeNoteAt])

  useEffect(() => {
    if (!draft) return

    // While a conflict is open, keep my text in this browser, so leaving or reloading keeps it.
    if (conflictRef.current) idbSet(mineKeyOf(id), keptFor(plainText(draft))).catch(() => {})

    // Auto-save on changes
    const currentState = JSON.stringify(draft)
    if (currentState !== lastSavedRef.current) {
      saveDraft(draft, false)
    }
  }, [draft, saveDraft, id, conflict, idbSet])

  useEffect(() => {
    // Save before unload, but only real unsaved edits: an untouched draft must not overwrite a newer version.
    const handleBeforeUnload = event => {
      // While a conflict waits for the user's choice nothing is saved, so ask before the page closes.
      if (conflictRef.current) {
        event.preventDefault()
        event.returnValue = ''
        return
      }
      // The copy box holds my text: ask, and still save any unsaved edits below.
      if (copyTextRef.current !== null) {
        event.preventDefault()
        event.returnValue = ''
      }
      if (draft && JSON.stringify(draft) !== lastSavedRef.current) {
        // Unsaved edits: ask before the page closes. The save below may be refused (412) or not finish.
        event.preventDefault()
        event.returnValue = ''
        saveDraft(draft, true, true)
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [draft, saveDraft])

  // Another app changed the draft (#363): show it without a reload, and highlight the posts whose text changed.
  const showNewer = incoming => {
    // Never move back to an older version than the one the editor holds.
    if (!(incoming.version > versionRef.current)) return
    const next = normalizeDraft(incoming)
    const before = new Map((draftRef.current?.posts || []).map(post => [post.id, post.text]))
    const changedIds = next.posts.filter(post => before.get(post.id) !== post.text).map(post => post.id)
    versionRef.current = incoming.version
    lastSavedRef.current = JSON.stringify(next)
    setDraft(next)
    idbSet(`draft-${id}`, incoming).catch(() => {})
    setHighlighted(changedIds)
    setUpdatedAt(Date.now())
    setClock(Date.now())
  }

  // Checks for newer versions only while the page is visible, nothing is unsaved, and no save is in flight.
  const live = useDraftLive(id, {
    enabled: Boolean(draft) && Boolean(user) && !conflict && !loading,
    canCheck: () =>
      savingCountRef.current === 0 &&
      !conflictRef.current &&
      !uploadsPending() &&
      draft !== null &&
      JSON.stringify(draft) === lastSavedRef.current,
    getVersion: () => versionRef.current,
    onNewer: showNewer
  })

  // The highlight lasts 1.5 s; the "Updated ..." line is refreshed every 30 s.
  useEffect(() => {
    if (highlighted.length === 0) return undefined
    const timer = setTimeout(() => setHighlighted([]), 1500)
    return () => clearTimeout(timer)
  }, [highlighted])
  useEffect(() => {
    if (updatedAt === null) return undefined
    const timer = setInterval(() => setClock(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [updatedAt])

  // "Show their changes": keep my text for copying, then show the draft the other app saved.
  const showTheirs = () => {
    if (!conflict?.theirs || !Number.isInteger(conflict.version)) return
    const kept = keptFor(plainText(draft))
    setCopy(kept)
    const theirs = normalizeDraft(conflict.theirs)
    versionRef.current = conflict.version
    lastSavedRef.current = JSON.stringify(theirs)
    setDraft(theirs)
    conflictRef.current = false
    setConflict(null)
    idbSet(`draft-${id}`, theirs).catch(() => {})
    idbSet(mineKeyOf(id), kept).catch(() => {})
  }

  // "Keep mine": save my text as a new version on top of theirs.
  const keepMine = () => {
    if (!Number.isInteger(conflict?.version)) return
    versionRef.current = conflict.version
    conflictRef.current = false
    setConflict(null)
    saveDraft(draft, true)
  }

  // Back link: while a conflict or the copy box holds text that is not saved, ask before leaving.
  const handleBack = async event => {
    if (!conflict && copyText === null) return
    event.preventDefault()
    const confirmed = await ask({
      title: 'Leave this draft?',
      body: 'This draft changed in another app and your text is not saved. Leaving keeps your text in this browser. Open this draft again to copy it.',
      confirmLabel: 'Leave',
      tone: 'danger'
    })
    if (confirmed) navigate('/')
  }

  const copyMyText = async () => {
    try {
      await navigator.clipboard.writeText(copyText)
      toast({ message: 'Copied', tone: 'success' })
    } catch {
      toast({ message: 'Could not copy. Select the text and copy it.', tone: 'danger' })
    }
  }

  const handleTitleChange = (newTitle) => {
    setDraft({ ...draft, title: newTitle })
  }

  const handlePostsChange = (newPosts) => {
    setDraft({ ...draft, posts: newPosts })
  }

  const handlePublish = async () => {
    const confirmed = await ask({
      title: 'Publish this draft?',
      body: 'Mark this draft as published? This will delete all uploaded images and move the draft to your Published list.',
      confirmLabel: 'Publish',
      tone: 'primary'
    })

    if (!confirmed) return

    try {
      setSaving(true)

      // Publish reads the saved posts on the server, so flush the pending autosave first. The draft is read after
      // the confirmation: a live update made while the dialog was open must not be overwritten (#363).
      const saved = await saveDraft(draftRef.current, true)
      if (!saved) throw new Error('Could not save your latest edits. Try again.')

      // The server deletes the draft's images, clears them from posts and marks it published.
      await draftsApi.publish(id)

      toast({ message: 'Draft published successfully!', tone: 'success' })
      navigate('/')
    } catch (err) {
      console.error('Publish error:', err)
      toast({ message: 'Failed to publish: ' + err.message, tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Page width="narrow">
        <Skeleton lines={4} />
      </Page>
    )
  }

  if (error) return <LoadError error={error} />

  if (!draft) {
    return (
      <LoadScreen
        title="Draft Not Found"
        action={<Button variant="primary" to="/">Back to Home</Button>}
      />
    )
  }

  // The save status word and its tone: the same texts as before, announced when they change.
  const saveStatus = signedOut || conflict
    ? { tone: 'danger', text: 'Not saved' }
    : !synced || saving
      ? { tone: 'warning', text: 'Saving…' }
      : { tone: 'success', text: 'Saved' }

  return (
    <div className="draft-editor">
      <PageHeader
        sticky
        back={{ to: '/', label: '← Back', onClick: handleBack }}
        titleSlot={
          <h1>
            <Input value={draft.title} onChange={handleTitleChange} disabled={Boolean(viewAs)} ariaLabel="Draft title" placeholder="Untitled Draft" />
          </h1>
        }
        status={
          <>
            <Badge tone={saveStatus.tone} live>
              {saveStatus.text}
            </Badge>
            <LiveStatus
              updatedText={updatedAt === null ? null : updatedLabel(clock - updatedAt)}
              paused={live.paused}
              onResume={live.resume}
            />
          </>
        }
        actions={
          <>
            <ShareLinkButton draftId={id} />
            <AgentLinkButton draftId={id} />
            <XThreadLinkButton draftId={id} />
            <ExportOptions draft={draft} />
            {!draft.is_published && (
              <Button variant="primary" icon="publish" onClick={handlePublish} disabled={saving} disabledReason={reason} ariaLabel="Publish">
                Publish
              </Button>
            )}
          </>
        }
      />

      <div className="editor-content">
        <div className="main-panel">
          <Stack gap={4}>
            {signedOut && (
              <Banner
                tone="danger"
                role="alert"
                actions={
                  <Button variant="secondary" onClick={() => authApi.login()}>
                    Sign in with GitHub
                  </Button>
                }
              >
                You are signed out. Your text is still here: copy it, then sign in again.
              </Banner>
            )}

            <ThreadComposer posts={draft.posts} onPostsChange={handlePostsChange} highlightIds={highlighted} />

            {mergeNoteAt !== null && !conflict && (
              <Banner tone="info">Changes from another app were added. Your edits are kept.</Banner>
            )}

            {conflict && (
              <Banner
                tone="warning"
                role="alert"
                actions={
                  <>
                    <Button variant="secondary" onClick={showTheirs}>
                      Show their changes
                    </Button>
                    <Button variant="primary" onClick={keepMine}>
                      Keep mine
                    </Button>
                  </>
                }
              >
                This draft changed in another app while you were editing. Autosave is paused until you choose.
              </Banner>
            )}

            {copyText !== null && (
              <Banner
                tone="info"
                role="status"
                actions={
                  <>
                    <Button variant="secondary" onClick={copyMyText}>
                      Copy
                    </Button>
                    <Button variant="ghost" onClick={() => {
                      setCopy(null)
                      // A conflict is still open: keep my current text, not the copy that was dismissed.
                      if (conflictRef.current) idbSet(mineKeyOf(id), plainText(draft)).catch(() => {})
                      else idbDel(mineKeyOf(id)).catch(() => {})
                    }}>
                      Dismiss
                    </Button>
                  </>
                }
              >
                <p>Your text is below. Copy what you need.</p>
                <textarea readOnly rows={8} value={copyText} aria-label="Your text" />
              </Banner>
            )}

            {!draft.is_published && (
              <Banner tone="info" role="none">
                Images upload automatically. Changes save as you type.
              </Banner>
            )}

            {draft.is_published && (
              <Banner tone="success" role="none">
                📤 This draft has been published
              </Banner>
            )}
          </Stack>
        </div>
      </div>
    </div>
  )
}

// A screen for a draft that did not open: a title, a line, and one action. Signed-out screens have no bar (no sign-out).
function LoadScreen({ title, description, action, signedOut = false }) {
  return (
    <Page width="narrow">
      <Stack gap={4}>
        <PageHeader title={title} subtitle={description} menu={false} bar={!signedOut} />
        {action}
      </Stack>
    </Page>
  )
}

// The screen for a draft that did not load. Kept out of DraftEditor so the editor's complexity stays within the lint limit.
function LoadError({ error }) {
  if (error.status === 401) {
    return (
      <LoadScreen
        signedOut
        title="Sign in to open this draft"
        description="Drafts are private. Sign in with the account that owns this draft."
        action={<Button variant="primary" onClick={() => authApi.login()}>Sign in with GitHub</Button>}
      />
    )
  }

  if (error.status === 404) {
    return (
      <LoadScreen
        title="Draft not found"
        action={<Button variant="primary" to="/">Back to Home</Button>}
      />
    )
  }

  return (
    <LoadScreen
      title="Error"
      description={error.message}
      action={<Button variant="primary" to="/">Back to Home</Button>}
    />
  )
}
