import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MemoryCardList } from '../components/MemoryCardList'
import { MemoryEditor } from '../components/MemoryEditor'
import { useEditMode } from '../lib/editContext'
import { placeMemories } from '../lib/memories'

export function PlacesPage() {
  const { enabled } = useEditMode()
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  return (
    <section className="mx-auto w-full max-w-3xl px-5 pb-20 pt-4 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display rise-in text-4xl text-[var(--ink)] sm:text-5xl">地方</h1>
          <p className="rise-in rise-in-delay-1 mt-3 text-[var(--ink-soft)]">
            对你们有意义的地点。去过不止一次，也可以仍写一条。
          </p>
        </div>
        {enabled ? (
          <button
            type="button"
            className="bg-[var(--leaf)] px-4 py-2 text-sm text-[var(--foam)]"
            onClick={() => setCreating((v) => !v)}
          >
            {creating ? '收起' : '新建'}
          </button>
        ) : null}
      </div>

      {creating ? (
        <MemoryEditor
          mode="create"
          initial={{ kind: 'place' }}
          onCancel={() => setCreating(false)}
          onSaved={(slug) => {
            setCreating(false)
            navigate(`/m/${slug}`)
          }}
        />
      ) : null}

      <MemoryCardList
        items={placeMemories}
        empty="还没有地方。径山寺、盒马、小河直街……从有画面的地方开始。"
      />
    </section>
  )
}
