import { describe, expect, it } from 'vitest'
import {
  emptyGomokuBoard,
  findRunMarks,
  gomokuIndex,
  type GomokuBoard,
  type Stone,
} from './gomoku'

function place(board: GomokuBoard, cells: Array<[number, number]>, stone: Stone) {
  for (const [r, c] of cells) board[gomokuIndex(r, c)] = stone
}

describe('findRunMarks three', () => {
  it('marks live three .XXX.', () => {
    const board = emptyGomokuBoard()
    place(board, [
      [7, 5],
      [7, 6],
      [7, 7],
    ], 'white')
    const marks = findRunMarks(board, 'white')
    expect([...marks.three].sort()).toEqual(
      [gomokuIndex(7, 5), gomokuIndex(7, 6), gomokuIndex(7, 7)].sort(),
    )
  })

  it('does not mark blocked three OXXX.', () => {
    const board = emptyGomokuBoard()
    place(board, [[7, 4]], 'black')
    place(board, [
      [7, 5],
      [7, 6],
      [7, 7],
    ], 'white')
    const marks = findRunMarks(board, 'white')
    expect(marks.three.size).toBe(0)
  })

  it('marks live jump three .XX.X.', () => {
    const board = emptyGomokuBoard()
    place(board, [
      [7, 5],
      [7, 6],
      [7, 8],
    ], 'white')
    const marks = findRunMarks(board, 'white')
    expect([...marks.three].sort()).toEqual(
      [gomokuIndex(7, 5), gomokuIndex(7, 6), gomokuIndex(7, 8)].sort(),
    )
  })

  it('does not mark blocked jump three OXX.X.', () => {
    const board = emptyGomokuBoard()
    place(board, [[7, 4]], 'black')
    place(board, [
      [7, 5],
      [7, 6],
      [7, 8],
    ], 'white')
    const marks = findRunMarks(board, 'white')
    expect(marks.three.size).toBe(0)
  })
})
