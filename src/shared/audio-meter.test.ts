import { describe, expect, it } from 'vitest'
import { meterFill, meterStep, rms } from './audio-meter'
import { operatorPlays } from './omt'

describe('rms', () => {
  it('is 0 for silence and empty blocks, the amplitude for a constant block', () => {
    expect(rms([])).toBe(0)
    expect(rms([0, 0, 0])).toBe(0)
    expect(rms([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5)
  })
})

describe('meterFill', () => {
  it('rests empty for silence and below the floor, full at 0 dBFS', () => {
    expect(meterFill(0)).toBe(0)
    expect(meterFill(NaN)).toBe(0)
    expect(meterFill(0.0005)).toBe(0)
    expect(meterFill(1)).toBe(1)
    expect(meterFill(2)).toBe(1)
  })
  it('puts -30 dBFS halfway', () => {
    expect(meterFill(Math.pow(10, -30 / 20))).toBeCloseTo(0.5)
  })
})

describe('meterStep', () => {
  it('rises at once and falls slowly', () => {
    expect(meterStep(0.2, 0.8)).toBe(0.8)
    expect(meterStep(0.8, 0)).toBeCloseTo(0.74)
    expect(meterStep(0.03, 0)).toBe(0)
  })
})

describe('operatorPlays', () => {
  it('plays by itself only when no output owns the sound', () => {
    expect(operatorPlays(false, false, false)).toEqual({ local: true, auto: true })
    expect(operatorPlays(true, false, false)).toEqual({ local: false, auto: false })
    expect(operatorPlays(false, true, false)).toEqual({ local: false, auto: false })
  })
  it('Monitor plays it as well, even while an output does', () => {
    expect(operatorPlays(true, true, true)).toEqual({ local: true, auto: false })
    expect(operatorPlays(false, false, true)).toEqual({ local: true, auto: true })
  })
})
