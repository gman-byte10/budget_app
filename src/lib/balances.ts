import type { Account, Transaction } from '../db/schema'

// Posting rules (uniform across account types, incl. manually-paid credit):
//   expense  → accountId      −= amount
//   income   → accountId      += amount
//   transfer → accountId(src) −= amount,  toAccountId(dst) += amount
// A credit card you owe on simply carries a negative balance; paying it is a
// transfer into it. Net worth = sum of all balances (credit counts negative).

export function computeBalances(accounts: Account[], txns: Transaction[]): Map<string, number> {
  const bal = new Map<string, number>()
  for (const a of accounts) bal.set(a.id, a.openingBalance)
  for (const t of txns) {
    if (t.type === 'expense') {
      bal.set(t.accountId, (bal.get(t.accountId) ?? 0) - t.amount)
    } else if (t.type === 'income') {
      bal.set(t.accountId, (bal.get(t.accountId) ?? 0) + t.amount)
    } else if (t.type === 'transfer' && t.toAccountId) {
      bal.set(t.accountId, (bal.get(t.accountId) ?? 0) - t.amount)
      bal.set(t.toAccountId, (bal.get(t.toAccountId) ?? 0) + t.amount)
    }
  }
  return bal
}

export function netWorth(balances: Map<string, number>): number {
  let sum = 0
  for (const v of balances.values()) sum += v
  return sum
}
