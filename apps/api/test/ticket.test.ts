import test from 'node:test'
import assert from 'node:assert/strict'
import { generateTicket } from '../src/modules/games/ticket'
import { isClaimEligible } from '@tambola/shared/claims'

test('1,000 generated tickets obey row, column, band, corner, and uniqueness rules', () => {
  const seen = new Set<number>()
  for (let i = 0; i < 1000; i++) {
    const ticket = generateTicket()
    assert.equal(ticket.length, 3)
    for (const row of ticket) {
      assert.equal(row.length, 9)
      assert.equal(row.filter(n => n !== null).length, 5)
    }
    const numbers = ticket.flat().filter((n): n is number => n !== null)
    numbers.forEach(n => seen.add(n))
    assert.equal(new Set(numbers).size, 15)
    for (let col = 0; col < 9; col++) {
      const values = ticket.map(row => row[col]).filter((n): n is number => n !== null)
      assert.ok(values.length >= 1 && values.length <= 3)
      assert.deepEqual(values, [...values].sort((a, b) => a - b))
      assert.ok(values.every(n => n >= (col === 0 ? 1 : col * 10) && n <= (col === 8 ? 90 : col * 10 + 9)))
    }
    for (const [r, c] of [[0, 0], [0, 8], [2, 0], [2, 8]]) assert.notEqual(ticket[r][c], null)
    assert.equal(isClaimEligible('full_house', ticket, new Set(numbers), new Set()), true)
    assert.equal(isClaimEligible('four_corners', ticket, new Set(numbers), new Set()), true)
    assert.equal(isClaimEligible('top_line', ticket, new Set(numbers), new Set()), true)
    assert.equal(isClaimEligible('full_house', ticket, new Set(numbers), new Set([numbers[0]])), false)
  }
  assert.equal(seen.size, 90)
})
