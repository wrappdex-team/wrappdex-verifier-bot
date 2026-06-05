const required = (key: string): string => {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
};

export const config = {
  DISCORD_BOT_TOKEN: required('DISCORD_BOT_TOKEN'),
  DISCORD_CLIENT_ID: required('DISCORD_CLIENT_ID'),
  DISCORD_GUILD_ID: required('DISCORD_GUILD_ID'),

  DISCORD_HOLDER_H_ROLE_ID: '1423668292027158659',
  DISCORD_VIP_DAO_ROLE_ID: '1424153762112602253',

  HEDERA_MIRROR_BASE_URL: 'https://mainnet-public.mirrornode.hedera.com',
  HEDERA_BOT_ACCOUNT_ID: process.env.HEDERA_BOT_ACCOUNT_ID || "",

  H_TOKEN_ID: '0.0.9356476',
  H_TOKEN_DECIMALS: 8,
  H_TOKEN_HOLDER_MIN: 1,
  H_TOKEN_VIP_MIN: 100_000_000,

  WRAPPED_ONE_NFT_TOKEN_ID: '0.0.10146181',

  VERIFY_AMOUNT_TINYBARS: 100_000,
  VERIFY_EXPIRY_MS: 10 * 60 * 1000,
} as const;
