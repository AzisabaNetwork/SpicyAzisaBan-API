declare type Player = {
  uuid: string // uuid
  name: string
  ip: string
  last_seen: number
}

declare type Proof = {
  id: number
  punish_id: number
  text: string
}

declare type Unpunish = {
  id: number
  punish_id: number
  reason: string
  timestamp: number
  operator: string // uuid
  operator_name?: string
}

declare type ServerGroup = {
  server: string
  group: string
}

declare type Punishment = {
  id: number
  name: string // player name
  target: string // player uuid
  reason: string
  operator: string // operator uuid
  operator_name?: string
  type: PunishmentType
  start: number
  end: number
  server: string
  extra: string
  unpunished?: boolean
  unpunish?: Unpunish | null
  proofs?: Array<Proof>
  active?: boolean
}

declare type User = {
  id: number
  username: string
  email?: string
  group: string
  last_update: Date
}

declare type PunishmentType =
  | "BAN"
  | "TEMP_BAN"
  | "IP_BAN"
  | "TEMP_IP_BAN"
  | "MUTE"
  | "TEMP_MUTE"
  | "IP_MUTE"
  | "TEMP_IP_MUTE"
  | "WARNING"
  | "CAUTION"
  | "KICK"
  | "NOTE"

declare type SessionTable = {
  [state: string]: Session
}

declare type Session = {
  expires_at: number
  user_id: number
  ip: string
  pending: boolean
}
