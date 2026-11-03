import { useEffect, useState } from 'react'
import { MemoryList } from '../../components/MemoryList'
import { filterMemories, loadMemories } from '../../lib/content'
import type { Memory } from '../../lib/types'
import '../milestones/index.scss'

export default function ImpressionsPage() {
  const [items, setItems] = useState<Memory[]>([])
  useEffect(() => {
    void loadMemories().then((all) => setItems(filterMemories(all, 'impression')))
  }, [])
  return <MemoryList title='印象' subtitle='关于彼此的小印象' items={items} />
}
