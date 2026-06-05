# WRAPpDEX Verifier Bot — Verify.ħ

A Discord bot that verifies Hedera wallet ownership and automatically assigns roles based on token and NFT holdings. Built for the WRAPp DEX community.

---

## Features

- **Wallet ownership proof** via a small HBAR transfer with a unique memo code
- **Multi-wallet support** — link multiple Hedera accounts per Discord user
- **Automatic role assignment** for Holder.ℏ, VIP & DAO, and any custom-configured roles
- **Custom rule engine** — Admins can create new role conditions for any token or NFT
- **Auto role sync** every 30 minutes across all linked wallets
- **Role revocation** when holdings drop below threshold or wallets are unlinked

---

## Slash Commands

### User commands

| Command | Description |
|---------|-------------|
| `/verify <wallet>` | Start wallet verification — checks balances and generates a unique memo code |
| `/confirm` | Complete verification after sending the 0.001 HBAR proof transaction |
| `/wallets` | List all Hedera wallets linked to your account |
| `/unlink <wallet>` | Remove a wallet and re-evaluate roles across remaining wallets |

### Admin/Mod commands (requires Manage Roles permission)

| Command | Description |
|---------|-------------|
| `/rule add` | Create a new role assignment rule for a token or NFT |
| `/rule list` | Show all active custom rules |
| `/rule remove <id>` | Delete a rule by its ID |

---

## Verification Flow

```
User runs /verify 0.0.XXXXXX
        │
        ▼
Bot checks wallet on Hedera Mirror Node:
  - HBAR.ℏ token balance (0.0.9356476)
  - The Wrapped One NFT count (0.0.10146181)
  - All custom rule tokens/NFTs
        │
        ▼
If qualifies → generates unique memo code (WRAPpDEX-XXXXXXX)
        │
        ▼
User sends 0.001 HBAR from their wallet to bot account
with exact memo within 10 minutes
        │
        ▼
User runs /confirm
        │
        ▼
Bot verifies transaction on Mirror Node → links wallet → assigns roles
```

---

## Default Role Rules

| Role | Condition |
|------|-----------|
| **Holder.ℏ** | HBAR.ℏ token balance > 1 |
| **VIP & DAO** | HBAR.ℏ token balance ≥ 100,000,000 OR holds ≥ 1 Wrapped One NFT |

---

## Custom Rule Engine (`/rule add`)

Admins can add unlimited additional role rules:

```
/rule add
  type:       Token (fungible) | NFT
  token_id:   0.0.XXXXXX          (Hedera token ID)
  role:       @RoleName           (Discord role to assign)
  min_amount: 1                   (minimum balance/NFT count, default: 1)
  decimals:   8                   (token decimals, default: 0, ignored for NFT)
  label:      "My Rule"           (optional display name)
```

Rules are stored in `data/rules.json` and persist across restarts.

---

## Auto Role Sync

Every 30 minutes the bot loops through all registered users, re-checks their wallet balances on Hedera, and adds or removes roles as needed — no user action required.

---

## Role Hierarchy Requirement

The bot's role (**Verify.ħ**) must be positioned **above** all roles it manages (VIP & DAO, Holder.ℏ, and any custom roles) in **Server Settings → Roles**.

The bot cannot modify roles of members whose highest role is equal to or above Verify.ħ (e.g. Admin, Core Team, Mod). Those members must have roles assigned manually.

---

## Project Structure

```
src/
├── bot.ts          # Main bot: slash command handlers, role evaluation, auto-sync
├── config.ts       # Environment config (tokens, role IDs, thresholds)
├── hedera.ts       # Hedera Mirror Node API calls (balances, NFT counts, tx lookup)
├── store.ts        # In-memory pending verification store (10 min TTL)
├── walletStore.ts  # Persistent wallet storage per Discord user (data/wallets.json)
└── ruleStore.ts    # Persistent custom rule storage (data/rules.json)

data/
├── wallets.json    # { userId: [accountId, ...] }
└── rules.json      # Array of custom role rules
```

---

## Environment Variables / Secrets

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_BOT_TOKEN` | ✅ | Bot token from Discord Developer Portal |
| `DISCORD_CLIENT_ID` | ✅ | Application ID from Discord Developer Portal |
| `DISCORD_GUILD_ID` | ✅ | Discord server (guild) ID |
| `HEDERA_BOT_ACCOUNT_ID` | ✅ | Hedera account that receives the 0.001 HBAR verification payment |
| `SESSION_SECRET` | optional | Reserved for future API use |

---

## Setup

### 1. Discord Developer Portal

1. Create a new application at [discord.com/developers](https://discord.com/developers/applications)
2. Add a Bot — copy the **Bot Token** → `DISCORD_BOT_TOKEN`
3. Copy the **Application ID** → `DISCORD_CLIENT_ID`
4. Enable **Server Members Intent** under Bot → Privileged Gateway Intents

### 2. Invite the bot to your server

Use this URL (replace `CLIENT_ID`):

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot+applications.commands&permissions=268435456
```

Permission `268435456` = **Manage Roles**.

### 3. Configure role IDs

In `src/config.ts`, set the correct Discord role IDs:

```typescript
DISCORD_HOLDER_H_ROLE_ID: '1423668292027158659',   // Holder.ℏ role ID
DISCORD_VIP_DAO_ROLE_ID:  '1424153762112602253',   // VIP & DAO role ID
```

To find a role ID: **Server Settings → Roles → right-click role → Copy ID** (requires Developer Mode).

### 4. Hedera bot account

The bot needs a Hedera account to receive the 0.001 HBAR verification payments. Set its ID in `HEDERA_BOT_ACCOUNT_ID`.

---

## Running locally

```bash
# Install dependencies
pnpm install

# Run the bot
pnpm run dev
```

Requires Node.js 20+ and pnpm.

---

## Tech Stack

- **[discord.js](https://discord.js.org/) v14** — Discord bot framework
- **Hedera Mirror Node** (mainnet-public.mirrornode.hedera.com) — read-only blockchain queries
- **TypeScript** — full type safety
- **tsx** — zero-config TypeScript runner
- **JSON file storage** — simple, portable persistence for wallets and rules

---

## Key Design Decisions

- **No Hedera SDK** — uses the public Mirror Node REST API only; no private keys stored
- **Proof-of-ownership via memo transaction** — the 0.001 HBAR transfer with a unique memo proves the user controls the wallet without sharing private keys
- **Guild commands** — registered as server-specific (not global) for instant propagation
- **Roles added AND removed** — the sync loop actively revokes roles when holdings drop, not just grants them
- **Custom rules are first-class** — the `/rule` engine extends the same evaluation and sync pipeline as the built-in rules
Deployment actualizado - 5 junio 2026
