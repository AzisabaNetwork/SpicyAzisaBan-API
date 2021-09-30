import bcrypt from 'bcrypt'

let goodSaltRounds = -1

/**
 * Get salt rounds to hash that can be hashed within a second.
 * @returns "good" salt rounds
 */
export const getGoodSaltRounds = async (): Promise<number> => {
  if (goodSaltRounds > 0) return goodSaltRounds
  let i = 10
  while (true) {
    const start = Date.now()
    await bcrypt.hash('test', i++)
    const end = Date.now()
    if (end - start > 1000) break
  }
  return goodSaltRounds = i - 1
}

export const hash = async (data: any): Promise<string> => await bcrypt.hash(data, await getGoodSaltRounds())

export * from 'bcrypt'
