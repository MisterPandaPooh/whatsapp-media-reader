// src/parser/id.ts
export function makeIdGenerator(chatId: string) {
  const used = new Set<string>()
  return function generateId(timestampMs: number, sender: string, content: string): string {
    const base = `${chatId}|${timestampMs}|${sender}|${content}`
    let hash = 5381
    for (let i = 0; i < base.length; i++) {
      hash = ((hash << 5) + hash) ^ base.charCodeAt(i)
    }
    const id = Math.abs(hash).toString(36)
    let unique = id
    let counter = 0
    while (used.has(unique)) {
      counter++
      unique = `${id}_${counter}`
    }
    used.add(unique)
    return unique
  }
}
