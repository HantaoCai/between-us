import { useEffect, useMemo, useRef, useState } from 'react'
import { View, Text, Image, Input, Textarea } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { AppNav } from '../../components/AppNav'
import { daysTogether, getSite, loadNotes } from '../../lib/content'
import { saveWallNotes, uploadWallPhoto } from '../../lib/cloudApi'
import { getWho, whoLabel } from '../../lib/identity'
import type { StickyNote } from '../../lib/types'
import {
  clamp,
  findPinSpot,
  nextTone,
  normalizeNotes,
  wallHeightForCount,
} from '../../lib/wall'
import './index.scss'

type ViewMode = 'wall' | 'browse'
type Draft = {
  id?: string
  mode: 'text' | 'photo'
  text: string
  detail: string
}

type DragState = {
  id: string
  startX: number
  startY: number
  originX: number
  originY: number
  moved: boolean
  wallW: number
  wallH: number
}

export default function HomePage() {
  const [notes, setNotes] = useState<StickyNote[]>([])
  const notesRef = useRef<StickyNote[]>([])
  const [viewMode, setViewMode] = useState<ViewMode>('wall')
  const [openId, setOpenId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<StickyNote | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const site = getSite()
  const days = daysTogether()
  const wallH = wallHeightForCount(notes.length)

  const photos = useMemo(
    () => notes.filter((n) => n.kind === 'photo' && n.src),
    [notes],
  )

  useEffect(() => {
    void loadNotes().then((list) => {
      const next = normalizeNotes(list)
      setNotes(next)
      notesRef.current = next
    })
  }, [])

  async function persist(next: StickyNote[], toast = true) {
    setBusy(true)
    setError('')
    try {
      setNotes(next)
      notesRef.current = next
      const ok = await saveWallNotes(next)
      if (toast) {
        Taro.showToast({
          title: ok ? '已同步' : '已上墙（云未通时仅本次有效）',
          icon: 'none',
        })
      }
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
      return false
    } finally {
      setBusy(false)
    }
  }

  function onPinClick(note: StickyNote) {
    if (note.kind === 'photo') {
      setLightbox(note)
      return
    }
    setOpenId(openId === note.id ? null : note.id)
  }

  function startPinText() {
    setDraft({ mode: 'text', text: '', detail: '' })
  }

  function startPinPhoto() {
    setDraft({ mode: 'photo', text: '', detail: '' })
  }

  function startEdit(note: StickyNote) {
    setDraft({
      id: note.id,
      mode: note.kind === 'photo' ? 'photo' : 'text',
      text: note.text,
      detail: note.detail,
    })
  }

  async function submitDraft() {
    if (!draft || busy) return
    const text = draft.text.trim()

    if (draft.id) {
      const next = notesRef.current.map((n) =>
        n.id === draft.id
          ? { ...n, text: text || n.text, detail: draft.detail.trim() }
          : n,
      )
      setDraft(null)
      await persist(next)
      return
    }

    if (draft.mode === 'photo') {
      await pinPhotos()
      return
    }

    if (!text) {
      setError('先写一句')
      return
    }
    const who = getWho() || 'her'
    const spot = findPinSpot(notesRef.current)
    const note: StickyNote = {
      id: `n-${Date.now()}`,
      kind: 'text',
      text,
      detail: draft.detail.trim(),
      about: who,
      src: '',
      x: spot.x,
      y: spot.y,
      rotate: spot.rotate,
      tone: nextTone(notesRef.current.length),
    }
    setDraft(null)
    await persist([...notesRef.current, note])
  }

  async function pinPhotos() {
    if (!draft || draft.mode !== 'photo') return
    let paths: string[] = []
    try {
      const pick = await Taro.chooseImage({
        count: 9,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      })
      paths = pick.tempFilePaths || []
    } catch {
      return
    }
    if (!paths.length) return

    setBusy(true)
    setError('')
    setDraft(null)
    let wall = notesRef.current
    const who = getWho() || 'her'
    const stamp = Date.now()
    let pinned = 0

    try {
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i]
        const fileId = await uploadWallPhoto(path)
        const spot = findPinSpot(wall)
        const note: StickyNote = {
          id: `p-${stamp}-${i}`,
          kind: 'photo',
          text: '',
          detail: '',
          about: who,
          src: fileId || path,
          x: spot.x,
          y: spot.y,
          rotate: spot.rotate,
          tone: 'cream',
        }
        wall = [...wall, note]
        setNotes(wall)
        notesRef.current = wall
        pinned += 1
      }
      await persist(wall)
    } catch (err) {
      if (pinned > 0) await persist(wall, false)
      setError(
        err instanceof Error
          ? `已钉 ${pinned} 张后失败：${err.message}`
          : '钉照片失败',
      )
    } finally {
      setBusy(false)
    }
  }

  async function removeNote(id: string) {
    const confirm = await Taro.showModal({
      title: '取下',
      content: '从墙上取下这张？',
      confirmText: '取下',
      confirmColor: '#b42318',
    })
    if (!confirm.confirm) return
    const next = notesRef.current.filter((n) => n.id !== id)
    if (openId === id) setOpenId(null)
    if (lightbox?.id === id) setLightbox(null)
    await persist(next)
  }

  function stepLightbox(dir: -1 | 1) {
    if (!lightbox || photos.length === 0) return
    const i = photos.findIndex((p) => p.id === lightbox.id)
    if (i < 0) {
      setLightbox(photos[0])
      return
    }
    setLightbox(photos[(i + dir + photos.length) % photos.length])
  }

  function onTouchStart(e: { touches: { clientX: number; clientY: number }[] }, note: StickyNote) {
    const t = e.touches[0]
    if (!t) return
    // 用屏幕宽近似墙宽；touch move 再校正
    const sys = Taro.getSystemInfoSync()
    dragRef.current = {
      id: note.id,
      startX: t.clientX,
      startY: t.clientY,
      originX: note.x,
      originY: note.y,
      moved: false,
      wallW: sys.windowWidth - 24,
      wallH,
    }
    setDraggingId(note.id)
  }

  function onTouchMove(e: { touches: { clientX: number; clientY: number }[]; preventDefault?: () => void }) {
    const drag = dragRef.current
    const t = e.touches[0]
    if (!drag || !t) return
    const dx = t.clientX - drag.startX
    const dy = t.clientY - drag.startY
    if (!drag.moved && Math.hypot(dx, dy) > 6) drag.moved = true
    if (!drag.moved) return
    e.preventDefault?.()
    const x = clamp(drag.originX + (dx / drag.wallW) * 100, 6, 94)
    const y = clamp(drag.originY + (dy / drag.wallH) * 100, 2, 78)
    setNotes((prev) => {
      const next = prev.map((n) =>
        n.id === drag.id
          ? { ...n, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
          : n,
      )
      notesRef.current = next
      return next
    })
  }

  async function onTouchEnd(_e: unknown, note: StickyNote) {
    const drag = dragRef.current
    dragRef.current = null
    setDraggingId(null)
    if (!drag || drag.id !== note.id) return
    if (!drag.moved) {
      onPinClick(note)
      return
    }
    await persist(notesRef.current, false)
  }

  function renderNoteCard(note: StickyNote, open: boolean) {
    const isPhoto = note.kind === 'photo' && note.src
    if (isPhoto) {
      return (
        <View className='sticky-photo'>
          <View className='sticky-pin' />
          <Image className='sticky-photo-img' src={note.src} mode='aspectFill' />
        </View>
      )
    }
    return (
      <View className={`sticky-note sticky-${note.tone}${open ? ' is-open' : ''}`}>
        <View className='sticky-pin' />
        <Text className='sticky-text'>{note.text}</Text>
        {open && note.detail ? <Text className='sticky-detail'>{note.detail}</Text> : null}
        {open ? (
          <View className='sticky-actions'>
            <Text
              className='sticky-action'
              onClick={(e) => {
                e.stopPropagation()
                startEdit(note)
              }}
            >
              改
            </Text>
            <Text
              className='sticky-action is-danger'
              onClick={(e) => {
                e.stopPropagation()
                void removeNote(note.id)
              }}
            >
              取下
            </Text>
          </View>
        ) : null}
      </View>
    )
  }

  return (
    <View className='wall-page'>
      <AppNav active='拾光' />
      <Text className='wall-brand'>Between Us</Text>
      <Text className='wall-days'>
        {site.togetherLabel} {days} 天 · {whoLabel(getWho())}
      </Text>

      <View className='wall-tools'>
        <View className='wall-filter'>
          <Text
            className={`wall-filter-btn${viewMode === 'wall' ? ' is-on' : ''}`}
            onClick={() => setViewMode('wall')}
          >
            墙面
          </Text>
          <Text
            className={`wall-filter-btn${viewMode === 'browse' ? ' is-on' : ''}`}
            onClick={() => setViewMode('browse')}
          >
            浏览
          </Text>
        </View>
        <View className='wall-pin-actions'>
          <Text className='wall-pin-link' onClick={startPinText}>
            钉贴纸
          </Text>
          <Text className='wall-pin-link' onClick={startPinPhoto}>
            {busy ? '钉着…' : '钉照片'}
          </Text>
        </View>
      </View>

      {viewMode === 'browse' ? (
        <View className='wall-browse'>
          <View className='wall-browse-list'>
            {notes.map((note) => {
              const isPhoto = note.kind === 'photo' && note.src
              const open = openId === note.id
              if (isPhoto) {
                return (
                  <View
                    key={note.id}
                    className='wall-browse-photo'
                    onClick={() => setLightbox(note)}
                  >
                    <Image className='wall-browse-photo-img' src={note.src} mode='aspectFill' />
                  </View>
                )
              }
              return (
                <View
                  key={note.id}
                  className={`wall-browse-note sticky-${note.tone}`}
                  onClick={() => setOpenId(open ? null : note.id)}
                >
                  <Text className='sticky-text'>{note.text}</Text>
                  {open && note.detail ? <Text className='sticky-detail'>{note.detail}</Text> : null}
                  {open ? (
                    <View className='sticky-actions'>
                      <Text className='sticky-action' onClick={() => startEdit(note)}>
                        改
                      </Text>
                      <Text
                        className='sticky-action is-danger'
                        onClick={() => void removeNote(note.id)}
                      >
                        取下
                      </Text>
                    </View>
                  ) : null}
                </View>
              )
            })}
          </View>
        </View>
      ) : (
        <View className='cork-wall' style={{ height: `${wallH}px` }} onClick={() => setOpenId(null)}>
          {notes.length === 0 ? (
            <Text className='cork-empty'>墙还空着。</Text>
          ) : (
            notes.map((note) => {
              const open = openId === note.id
              const dragging = draggingId === note.id
              return (
                <View
                  key={note.id}
                  className={`sticky-slot${dragging ? ' is-dragging' : ''}`}
                  style={{
                    left: `${note.x}%`,
                    top: `${note.y}%`,
                    transform: `translate(-50%, 0) rotate(${note.rotate}deg)`,
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onTouchStart={(e) => onTouchStart(e, note)}
                  onTouchMove={onTouchMove}
                  onTouchEnd={(e) => void onTouchEnd(e, note)}
                  onTouchCancel={(e) => void onTouchEnd(e, note)}
                >
                  {renderNoteCard(note, open)}
                </View>
              )
            })
          )}
        </View>
      )}

      {error ? <Text className='wall-error'>{error}</Text> : null}

      {draft ? (
        <View className='draft-overlay' onClick={() => !busy && setDraft(null)}>
          <View className='draft-sheet' onClick={(e) => e.stopPropagation()}>
            <Text className='draft-title'>
              {draft.id ? '改这张' : draft.mode === 'photo' ? '钉照片' : '钉贴纸'}
            </Text>
            <Text className='draft-hint'>
              {draft.id
                ? '改完点保存。'
                : draft.mode === 'photo'
                  ? '一次可选多张，按顺序钉上墙。'
                  : '写一句，钉上墙。'}
            </Text>
            {draft.mode === 'text' || draft.id ? (
              <>
                <Text className='draft-label'>便利贴上的字</Text>
                <Input
                  className='draft-input'
                  value={draft.text}
                  placeholder='会一个技能，钉一个'
                  onInput={(e) => setDraft({ ...draft, text: e.detail.value })}
                />
                <Text className='draft-label'>多说两句（可选）</Text>
                <Textarea
                  className='draft-textarea'
                  value={draft.detail}
                  placeholder='为什么觉得这一点好'
                  onInput={(e) => setDraft({ ...draft, detail: e.detail.value })}
                />
              </>
            ) : null}
            <View className='draft-actions'>
              <Text className='draft-cancel' onClick={() => !busy && setDraft(null)}>
                取消
              </Text>
              <Text className='draft-ok' onClick={() => void submitDraft()}>
                {busy
                  ? '钉着…'
                  : draft.id
                    ? '保存'
                    : draft.mode === 'photo'
                      ? '选图片钉上'
                      : '钉上墙'}
              </Text>
            </View>
          </View>
        </View>
      ) : null}

      {lightbox ? (
        <View className='lightbox'>
          <View className='lightbox-stage' onClick={() => setLightbox(null)}>
            <Image className='lightbox-img' src={lightbox.src} mode='aspectFit' />
          </View>
          <View className='lightbox-bar'>
            {photos.length > 1 ? (
              <View className='lightbox-nav'>
                <Text className='lightbox-btn' onClick={() => stepLightbox(-1)}>
                  上一张
                </Text>
                <Text className='lightbox-count'>
                  {Math.max(1, photos.findIndex((p) => p.id === lightbox.id) + 1)}/{photos.length}
                </Text>
                <Text className='lightbox-btn' onClick={() => stepLightbox(1)}>
                  下一张
                </Text>
              </View>
            ) : null}
            <View className='lightbox-actions'>
              <Text className='lightbox-btn is-danger' onClick={() => void removeNote(lightbox.id)}>
                取下
              </Text>
              <Text className='lightbox-btn' onClick={() => setLightbox(null)}>
                关闭
              </Text>
            </View>
          </View>
        </View>
      ) : null}
    </View>
  )
}
