export interface Clock { now(): Date }
export const browserClock: Clock = { now: () => new Date() };