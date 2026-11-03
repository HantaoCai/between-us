import { useEffect, useState } from 'react'
import { MemoryList } from '../../components/MemoryList'
import { filterMemories, loadMemories } from '../../lib/content'
import type { Memory } from '../../lib/types'
import './index.scss'

export default function MilestonesPage() {
  const [items, setItems] = useState<Memory[]>([])
  useEffect(() => {
    void loadMemories().then((all) => setItems(filterMemories(all, 'milestone')))
  }, [])
  return <MemoryList title='里程碑' subtitle='值得记住的节点' items={items} />
}
