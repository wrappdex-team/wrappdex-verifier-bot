import { config } from './config.js';

const MIRROR = config.HEDERA_MIRROR_BASE_URL;

interface TokenBalance {
  token_id: string;
  balance: number;
}

interface TokenBalanceResponse {
  tokens: TokenBalance[];
}

interface NftResponse {
  nfts: { token_id: string; serial_number: number }[];
}

interface Transaction {
  memo_base64: string;
  transfers: { account: string; amount: number }[];
  consensus_timestamp: string;
}

interface TransactionResponse {
  transactions: Transaction[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Hedera Mirror Node request failed: ${res.status} ${res.statusText} — ${url}`);
  }
  return res.json() as Promise<T>;
}

export async function getTokenBalance(accountId: string, tokenId: string): Promise<number> {
  const url = `${MIRROR}/api/v1/accounts/${encodeURIComponent(accountId)}/tokens?token.id=${encodeURIComponent(tokenId)}&limit=1`;
  const data = await fetchJson<TokenBalanceResponse>(url);
  const entry = data.tokens.find(t => t.token_id === tokenId);
  return entry?.balance ?? 0;
}

export async function getNftCount(accountId: string, tokenId: string): Promise<number> {
  const url = `${MIRROR}/api/v1/accounts/${encodeURIComponent(accountId)}/nfts?token.id=${encodeURIComponent(tokenId)}&limit=100`;
  const data = await fetchJson<NftResponse>(url);
  return data.nfts.length;
}

export async function accountExists(accountId: string): Promise<boolean> {
  const url = `${MIRROR}/api/v1/accounts/${encodeURIComponent(accountId)}`;
  const res = await fetch(url);
  return res.ok;
}

export async function findVerificationTx(
  senderAccount: string,
  expectedMemo: string,
  afterTimestamp: number,
): Promise<boolean> {
  const afterSec = (afterTimestamp / 1000 - 60).toFixed(0);
  const url = `${MIRROR}/api/v1/transactions?account.id=${encodeURIComponent(senderAccount)}&transactiontype=CRYPTOTRANSFER&result=success&order=desc&limit=25&timestamp=gte:${afterSec}`;
  const data = await fetchJson<TransactionResponse>(url);

  for (const tx of data.transactions) {
    const memo = Buffer.from(tx.memo_base64 ?? '', 'base64').toString('utf8').trim();
    if (memo !== expectedMemo) continue;

    const botReceived = tx.transfers.some(
      t => t.account === config.HEDERA_BOT_ACCOUNT_ID && t.amount >= config.VERIFY_AMOUNT_TINYBARS,
    );
    if (botReceived) return true;
  }

  return false;
}
