import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const DATA_FILE = join(DATA_DIR, 'wallets.json');

type WalletStore = Record<string, string[]>;

function load(): WalletStore {
  if (!existsSync(DATA_FILE)) return {};
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf8')) as WalletStore;
  } catch {
    return {};
  }
}

function save(store: WalletStore): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
}

export function getWallets(discordUserId: string): string[] {
  return load()[discordUserId] ?? [];
}

export function getAllUsers(): string[] {
  return Object.keys(load());
}

export function removeWallet(discordUserId: string, wallet: string): boolean {
  const store = load();
  const wallets = store[discordUserId] ?? [];
  if (!wallets.includes(wallet)) return false;
  store[discordUserId] = wallets.filter(w => w !== wallet);
  if (store[discordUserId].length === 0) delete store[discordUserId];
  save(store);
  return true;
}

export function addWallet(discordUserId: string, wallet: string): boolean {
  const store = load();
  const wallets = store[discordUserId] ?? [];
  if (wallets.includes(wallet)) return false;
  store[discordUserId] = [...wallets, wallet];
  save(store);
  return true;
}
