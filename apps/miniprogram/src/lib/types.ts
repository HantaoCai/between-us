export type NoteAbout = 'her' | 'me'
export type NoteTone = 'butter' | 'mint' | 'sky' | 'peach' | 'rose' | 'cream'
export type NoteKind = 'text' | 'photo'

export type StickyNote = {
  id: string
  kind: NoteKind
  text: string
  detail: string
  about: NoteAbout
  src: string
  x: number
  y: number
  rotate: number
  tone: NoteTone
}

export type MemoryKind = 'event' | 'impression' | 'milestone' | 'place'

export type Memory = {
  slug: string
  title: string
  date: string
  place: string
  mood: string
  tags: string[]
  cover: string
  kind: MemoryKind
  body: string
}

export type SiteMeta = {
  togetherSince: string
  togetherLabel: string
}
