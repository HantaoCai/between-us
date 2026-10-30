import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { MemoryCardList } from '../components/MemoryCardList'
import { MemoryEditor } from '../components/MemoryEditor'
import { useEditMode } from '../lib/editContext'
import { archiveMemories } from '../lib/memories'

export function ArchivePage() {
  const { enabled } = useEditMode()
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  return (
    <section className="mx-auto w-full max-w-3xl px-5 pb-20 pt-4 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display rise-in text-4xl text-[var(--ink)] sm:text-5xl">归档</h1>
          <p className="rise-in rise-in-delay-1 mt-3 text-[var(--ink-soft)]">
            以前的流水账时间线。日常琐碎放这里查，不占主页。重要的请移到
            <Link to="/milestones" className="text-[var(--leaf)]">
              里程碑
            </Link>
            或
            <Link to="/places" className="text-[var(--leaf)]">
              地方
            </Link>
            。
          </p>
        </div>
        {enabled ? (
          <button
            type="button"
            className="bg-[var(--leaf)] px-4 py-2 text-sm text-[var(--foam)]"
            onClick={() => setCreating((v) => !v)}
          >
            {creating ? '收起' : '新建日常'}
          </button>
        ) : null}
      </div>

      {creating ? (
        <MemoryEditor
          mode="create"
          initial={{ kind: 'event' }}
          onCancel={() => setCreating(false)}
          onSaved={(slug) => {
            setCreating(false)
            navigate(`/m/${slug}`)
          }}
        />
      ) : null}

      <MemoryCardList
        items={archiveMemories}
        empty="归档是空的。"
        showKind={false}
      />
    </section>
  )
}
