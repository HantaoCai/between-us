import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MemoryCardList } from '../components/MemoryCardList'
import { MemoryEditor } from '../components/MemoryEditor'
import { useEditMode } from '../lib/editContext'
import { milestoneMemories } from '../lib/memories'

export function MilestonesPage() {
  const { enabled } = useEditMode()
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  return (
    <section className="mx-auto w-full max-w-3xl px-5 pb-20 pt-4 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display rise-in text-4xl text-[var(--ink)] sm:text-5xl">里程碑</h1>
          <p className="rise-in rise-in-delay-1 mt-3 text-[var(--ink-soft)]">
            一年里只留会反复想起的转折，不记每一顿饭。
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
          initial={{ kind: 'milestone' }}
          onCancel={() => setCreating(false)}
          onSaved={(slug) => {
            setCreating(false)
            navigate(`/m/${slug}`)
          }}
        />
      ) : null}

      <MemoryCardList
        items={milestoneMemories}
        empty="还没有里程碑。把真正重要的几件事写在这里。"
      />
    </section>
  )
}
