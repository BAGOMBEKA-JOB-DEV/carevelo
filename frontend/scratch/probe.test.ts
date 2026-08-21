import { describe, expect, it } from 'vitest'
describe('probe', () => {
  it('has a dom', () => {
    expect(typeof document).toBe('object')
    expect(typeof Response).toBe('function')
    expect(typeof Headers).toBe('function')
    expect(new Headers([['set-cookie','a=1'],['set-cookie','b=2']]).getSetCookie()).toEqual(['a=1','b=2'])
  })
})
