import { useEffect, useState } from 'react'
import { MemoryList } from '../../components/MemoryList'
import { filterMemories, loadMemories } from '../../lib/content'
import type { Memory } from '../../lib/types'
import '../milestones/index.scss'

export default function PlacesPage() {
  const [items, setItems] = useState<Memory[]>([])
  useEffect(() => {
    void loadMemories().then((all) => setItems(filterMemories(all, 'place')))
  }, [])
  return <MemoryList title='地方' subtitle='一起走过的地方' items={items} />
}
