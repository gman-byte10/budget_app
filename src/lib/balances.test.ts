import { describe, it, expect } from 'vitest'
import { computeBalances, netWorth } from './balances'
import type { Account, Transaction } from '../db/schema'

const acct = (id: string, opening: number, type: Account['type'] = 'checking'): Account => ({
  id,
  name: id,
  type,
  openingBalance: opening,
  order: 0,
  createdAt: 0,
})
let n = 0
const tx = (p: Partial<Transaction>): Transaction => ({
  id: `t${n++}`,
  type: 'expense',
  amount: 0,
  date: '2026-01-01',
  accountId: 'a',
  createdAt: 0,
  ...p,
})

describe('balances', () => {
  it('applies expense and income to one account', () => {
    const accounts = [acct('a', 100)]
    const txns = [tx({ type: 'expense', amount: 30, accountId: 'a' }), tx({ type: 'income', amount: 50, accountId: 'a' })]
    const b = computeBalances(accounts, txns)
    expect(b.get('a')).toBe(120) // 100 - 30 + 50
  })

  it('transfer moves money without changing net worth', () => {
    const accounts = [acct('a', 100), acct('b', 0, 'savings')]
    const txns = [tx({ type: 'transfer', amount: 40, accountId: 'a', toAccountId: 'b' })]
    const b = computeBalances(accounts, txns)
    expect(b.get('a')).toBe(60)
    expect(b.get('b')).toBe(40)
    expect(netWorth(b)).toBe(100) // unchanged by the transfer
  })

  it('credit card expense goes more negative; paying it raises it', () => {
    const accounts = [acct('chk', 500), acct('cc', -200, 'credit')]
    const txns = [
      tx({ type: 'expense', amount: 50, accountId: 'cc' }), // now owe 250
      tx({ type: 'transfer', amount: 100, accountId: 'chk', toAccountId: 'cc' }), // pay down
    ]
    const b = computeBalances(accounts, txns)
    expect(b.get('cc')).toBe(-150) // -200 - 50 + 100
    expect(b.get('chk')).toBe(400)
    expect(netWorth(b)).toBe(250) // 400 + (-150)
  })
})
