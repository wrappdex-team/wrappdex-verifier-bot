interface PendingVerification {
  wallet: string;
  memo: string;
  expiresAt: number;
}

const pending = new Map<string, PendingVerification>();

export function setPending(discordUserId: string, data: PendingVerification): void {
  pending.set(discordUserId, data);
}

export function getPending(discordUserId: string): PendingVerification | undefined {
  return pending.get(discordUserId);
}

export function deletePending(discordUserId: string): void {
  pending.delete(discordUserId);
}
