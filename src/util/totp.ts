import { Secret, TOTP } from 'otpauth'

export const OPTIONS = {
  issuer: 'SpicyAzisaBan',
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  // label
  // secret
}

export const fromSecret = (secret: string): TOTP => new TOTP({
  ...OPTIONS,
  secret: Secret.fromUTF8(secret),
})

export const createNew = (label: string, secret: string): TOTP => new TOTP({
  ...OPTIONS,
  label,
  secret: Secret.fromUTF8(secret),
})

export const validate = (secret: string, token: string): boolean => {
  const delta = fromSecret(secret).validate({ token })
  if (delta === null) return false
  return Math.abs(delta) <= 1
}
