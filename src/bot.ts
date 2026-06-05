import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from './config.js';
import { accountExists, getTokenBalance, getNftCount, findVerificationTx } from './hedera.js';
import { setPending, getPending, deletePending } from './store.js';
import { addWallet, getWallets, getAllUsers, removeWallet } from './walletStore.js';
import { getRules, addRule, removeRule } from './ruleStore.js';

const WALLET_REGEX = /^0\.0\.\d+$/;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
  ],
});

function generateCode(): string {
  return 'WRAPpDEX-' + Math.random().toString(36).slice(2, 9).toUpperCase();
}

interface CustomRuleResult {
  ruleId: string;
  roleId: string;
  label: string;
  qualifies: boolean;
}

interface RoleQualification {
  qualifiesHolderH: boolean;
  qualifiesVipDao: boolean;
  customRuleResults: CustomRuleResult[];
}

async function evaluateRolesForWallets(wallets: string[]): Promise<RoleQualification> {
  let qualifiesHolderH = false;
  let qualifiesVipDao = false;

  const rules = getRules();
  const customQualifies = new Map<string, boolean>(rules.map(r => [r.id, false]));

  await Promise.all(wallets.map(async wallet => {
    const [hBalanceRaw, wrappedOneCount] = await Promise.all([
      getTokenBalance(wallet, config.H_TOKEN_ID),
      getNftCount(wallet, config.WRAPPED_ONE_NFT_TOKEN_ID),
    ]);
    const hBalance = hBalanceRaw / Math.pow(10, config.H_TOKEN_DECIMALS);
    if (hBalance > config.H_TOKEN_HOLDER_MIN) qualifiesHolderH = true;
    if (hBalance >= config.H_TOKEN_VIP_MIN || wrappedOneCount > 0) qualifiesVipDao = true;

    await Promise.all(rules.map(async rule => {
      if (customQualifies.get(rule.id)) return;
      let qualifies = false;
      if (rule.type === 'nft') {
        const count = await getNftCount(wallet, rule.tokenId);
        qualifies = count >= rule.minAmount;
      } else {
        const rawBalance = await getTokenBalance(wallet, rule.tokenId);
        const balance = rawBalance / Math.pow(10, rule.decimals);
        qualifies = balance >= rule.minAmount;
      }
      if (qualifies) customQualifies.set(rule.id, true);
    }));
  }));

  const customRuleResults: CustomRuleResult[] = rules.map(rule => ({
    ruleId: rule.id,
    roleId: rule.roleId,
    label: rule.roleName,
    qualifies: customQualifies.get(rule.id) ?? false,
  }));

  return { qualifiesHolderH, qualifiesVipDao, customRuleResults };
}

async function assignRoles(
  member: GuildMember,
  qual: RoleQualification,
  silent = false,
): Promise<{ granted: string[]; revoked: string[]; errors: string[] }> {
  const granted: string[] = [];
  const revoked: string[] = [];
  const errors: string[] = [];

  const roleMap = [
    { id: config.DISCORD_VIP_DAO_ROLE_ID, label: 'VIP & DAO', qualifies: qual.qualifiesVipDao },
    { id: config.DISCORD_HOLDER_H_ROLE_ID, label: 'Holder.ℏ', qualifies: qual.qualifiesHolderH },
    ...qual.customRuleResults.map(r => ({ id: r.roleId, label: r.label, qualifies: r.qualifies })),
  ];

  await Promise.all(roleMap.map(async ({ id, label, qualifies }) => {
    const hasRole = member.roles.cache.has(id);
    try {
      if (qualifies && !hasRole) {
        await member.roles.add(id);
        granted.push(`**${label}**`);
      } else if (!qualifies && hasRole) {
        await member.roles.remove(id);
        revoked.push(`**${label}**`);
      }
    } catch (err) {
      const e = err as { code?: number; message?: string; httpStatus?: number };
      console.error(`[assignRoles] Failed to update role "${label}" (${id}) for ${member.user.tag}: code=${e.code} status=${e.httpStatus} msg=${e.message}`);
      if (!silent) errors.push(`${label} (error ${e.code ?? e.httpStatus ?? '?'}: ${e.message ?? 'unknown'})`);
    }
  }));

  return { granted, revoked, errors };
}

async function syncAllRoles(): Promise<void> {
  const users = getAllUsers();
  if (users.length === 0) return;

  const guild = client.guilds.cache.get(config.DISCORD_GUILD_ID);
  if (!guild) {
    console.error('Sync: guild not found in cache');
    return;
  }

  console.log(`🔄 Starting role sync for ${users.length} user(s)…`);
  let synced = 0;
  let skipped = 0;

  await Promise.all(users.map(async userId => {
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) { skipped++; return; }

      const wallets = getWallets(userId);
      const qual = await evaluateRolesForWallets(wallets);
      const { granted, revoked } = await assignRoles(member, qual, true);

      if (granted.length > 0 || revoked.length > 0) {
        console.log(`  ${member.user.tag}: +[${granted.join(', ')}] -[${revoked.join(', ')}]`);
      }
      synced++;
    } catch (err) {
      console.error(`  Sync error for ${userId}:`, err);
    }
  }));

  console.log(`✅ Role sync complete — ${synced} synced, ${skipped} not in server`);
}

async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.DISCORD_BOT_TOKEN);

  // 1. Borramos TODOS los comandos antiguos primero (limpieza)
  await rest.put(
    Routes.applicationCommands(config.DISCORD_CLIENT_ID),
    { body: [] }
  );
  console.log('🧹 Old commands cleared');

  // 2. Definimos los comandos nuevos
  const commands = [
    new SlashCommandBuilder()
      .setName('verify')
      .setDescription('Link a Hedera wallet — proves ownership via a small HBAR transfer with a unique memo (new)')
      .addStringOption(option =>
        option
          .setName('wallet')
          .setDescription('Your Hedera Account ID (e.g. 0.0.123456)')
          .setRequired(true),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('confirm')
      .setDescription('Confirm wallet ownership after sending the HBAR transfer with the unique memo (new)')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('wallets')
      .setDescription('Show all Hedera wallets linked to your Discord account (new)')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('unlink')
      .setDescription('Remove a Hedera wallet from your Discord account (new)')
      .addStringOption(option =>
        option
          .setName('wallet')
          .setDescription('The Hedera Account ID to unlink (e.g. 0.0.123456)')
          .setRequired(true),
      )
      .toJSON(),
    new SlashCommandBuilder()
      .setName('rule')
      .setDescription('(Admin/Mod) Manage custom token/NFT role assignment rules (new)')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addSubcommand(sub =>
        sub
          .setName('add')
          .setDescription('Create a new role assignment rule for a token or NFT')
          .addStringOption(o =>
            o.setName('type').setDescription('token or nft').setRequired(true)
              .addChoices({ name: 'Token (fungible)', value: 'token' }, { name: 'NFT', value: 'nft' }),
          )
          .addStringOption(o =>
            o.setName('token_id').setDescription('Hedera token ID (e.g. 0.0.123456)').setRequired(true),
          )
          .addRoleOption(o =>
            o.setName('role').setDescription('Discord role to assign').setRequired(true),
          )
          .addNumberOption(o =>
            o.setName('min_amount').setDescription('Minimum balance/count required (default: 1)').setRequired(false),
          )
          .addIntegerOption(o =>
            o.setName('decimals').setDescription('Token decimals — only for fungible tokens (default: 0)').setRequired(false),
          )
          .addStringOption(o =>
            o.setName('label').setDescription('Human-readable rule name (optional)').setRequired(false),
          ),
      )
      .addSubcommand(sub =>
        sub
          .setName('remove')
          .setDescription('Delete a rule by its ID (new)')
          .addStringOption(o =>
            o.setName('id').setDescription('Rule ID (get it from /rule list)').setRequired(true),
          ),
      )
      .addSubcommand(sub =>
        sub.setName('list').setDescription('Show all active custom rules'),
      )
      .toJSON(),
  ];

  // 3. Registramos los comandos nuevos
  await rest.put(
    Routes.applicationCommands(config.DISCORD_CLIENT_ID),
    { body: commands },
  );
  console.log('✅ Guild slash commands registered cleanly');
}

async function handleVerify(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const wallet = interaction.options.getString('wallet', true).trim();

  if (!WALLET_REGEX.test(wallet)) {
    await interaction.editReply({ content: '❌ Invalid format. Example: `0.0.123456`' });
    return;
  }

  const linkedWallets = getWallets(interaction.user.id);
  if (linkedWallets.includes(wallet)) {
    await interaction.editReply({
      content: `ℹ️ Wallet \`${wallet}\` is already linked to your account.`,
    });
    return;
  }

  const exists = await accountExists(wallet);
  if (!exists) {
    await interaction.editReply({
      content: `❌ Account \`${wallet}\` not found on Hedera mainnet.`,
    });
    return;
  }

  const [hBalanceRaw, wrappedOneCount] = await Promise.all([
    getTokenBalance(wallet, config.H_TOKEN_ID),
    getNftCount(wallet, config.WRAPPED_ONE_NFT_TOKEN_ID),
  ]);

  const hBalance = hBalanceRaw / Math.pow(10, config.H_TOKEN_DECIMALS);
  const isWrappedOneHolder = wrappedOneCount > 0;
  const qualifiesHolderH = hBalance > config.H_TOKEN_HOLDER_MIN;
  const qualifiesVipDao = hBalance >= config.H_TOKEN_VIP_MIN || isWrappedOneHolder;

  if (!qualifiesHolderH && !qualifiesVipDao) {
    const lines = [
      `🔎 **Wallet checked:** \`${wallet}\``,
      '',
      `**HBAR.ℏ** (${config.H_TOKEN_ID}): \`${hBalance.toLocaleString()}\` — ❌ Does not qualify`,
      `**The Wrapped One NFT** (${config.WRAPPED_ONE_NFT_TOKEN_ID}): \`${wrappedOneCount}\` NFT(s) — ❌ Not a holder`,
      '',
      'ℹ️ This wallet does not meet the requirements for any role.',
    ];
    await interaction.editReply({ content: lines.join('\n') });
    return;
  }

  const memo = generateCode();
  const expiresAt = Date.now() + config.VERIFY_EXPIRY_MS;
  setPending(interaction.user.id, { wallet, memo, expiresAt });

  const hLine = hBalance >= config.H_TOKEN_VIP_MIN
    ? `✅ VIP & DAO + Holder.ℏ (≥ ${config.H_TOKEN_VIP_MIN.toLocaleString()} HBAR.ℏ)`
    : qualifiesHolderH
      ? `✅ Holder.ℏ (> ${config.H_TOKEN_HOLDER_MIN.toLocaleString()} HBAR.ℏ)`
      : `❌ Does not qualify`;

  const lines = [
    `🔎 **Wallet checked:** \`${wallet}\``,
    '',
    `**HBAR.ℏ** (${config.H_TOKEN_ID}): \`${hBalance.toLocaleString()}\` — ${hLine}`,
    `**The Wrapped One NFT** (${config.WRAPPED_ONE_NFT_TOKEN_ID}): \`${wrappedOneCount}\` NFT(s) — ${isWrappedOneHolder ? '✅ VIP & DAO' : '❌ Not a holder'}`,
    '',
    '─────────────────────────────',
    '**📤 Prove wallet ownership:**',
    '',
    `Send **0.001 HBAR** from \`${wallet}\` to:`,
    `> **\`${config.HEDERA_BOT_ACCOUNT_ID}\`**`,
    '',
    'With this exact memo:',
    `> **\`${memo}\`**`,
    '',
    '⏱️ Then run **`/confirm`** within **10 minutes**.',
    '─────────────────────────────',
  ];

  await interaction.editReply({ content: lines.join('\n') });
}

async function handleConfirm(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const pending = getPending(interaction.user.id);

  if (!pending) {
    await interaction.editReply({
      content: '❌ No pending verification found. Run `/verify <wallet>` first.',
    });
    return;
  }

  if (Date.now() > pending.expiresAt) {
    deletePending(interaction.user.id);
    await interaction.editReply({
      content: '❌ Your verification code expired. Please run `/verify` again.',
    });
    return;
  }

  await interaction.editReply({ content: '🔍 Checking the Hedera network for your transaction…' });

  const found = await findVerificationTx(
    pending.wallet,
    pending.memo,
    Date.now() - config.VERIFY_EXPIRY_MS,
  );

  if (!found) {
    const remaining = Math.ceil((pending.expiresAt - Date.now()) / 60_000);
    await interaction.editReply({
      content: [
        '❌ Transaction not found yet.',
        '',
        `Make sure you sent **0.001 HBAR** from \`${pending.wallet}\` to \`${config.HEDERA_BOT_ACCOUNT_ID}\` with memo \`${pending.memo}\`.`,
        `You have **${remaining} minute(s)** left. Try \`/confirm\` again after the transaction confirms.`,
      ].join('\n'),
    });
    return;
  }

  deletePending(interaction.user.id);
  const isNew = addWallet(interaction.user.id, pending.wallet);

  const allWallets = getWallets(interaction.user.id);
  const qual = await evaluateRolesForWallets(allWallets);
  const member = interaction.member as GuildMember;
  const { granted, revoked, errors } = await assignRoles(member, qual);

  const qualifiedRoleLabels: string[] = [];
  if (qual.qualifiesVipDao) qualifiedRoleLabels.push('**VIP & DAO**');
  if (qual.qualifiesHolderH) qualifiedRoleLabels.push('**Holder.ℏ**');
  qual.customRuleResults.filter(r => r.qualifies).forEach(r => qualifiedRoleLabels.push(`**${r.label}**`));

  const lines = [
    isNew
      ? `✅ **Wallet linked:** \`${pending.wallet}\``
      : `ℹ️ **Wallet already known:** \`${pending.wallet}\``,
    '',
    `📂 **Linked wallets (${allWallets.length}):** ${allWallets.map(w => `\`${w}\``).join(', ')}`,
    '',
  ];

  if (qualifiedRoleLabels.length === 0) {
    lines.push('ℹ️ No qualifying roles across your wallets.');
  } else if (granted.length > 0) {
    lines.push(`🎉 **Roles granted:** ${granted.join(', ')}`);
  } else if (errors.length > 0) {
    lines.push(`✅ **Qualifies for:** ${qualifiedRoleLabels.join(', ')}`);
    lines.push('⚠️ Roles could not be assigned automatically — a server admin needs to assign them manually.');
  } else {
    lines.push(`✅ **Roles already up to date:** ${qualifiedRoleLabels.join(', ')}`);
  }

  if (revoked.length > 0) lines.push(`🗑️ **Roles removed:** ${revoked.join(', ')}`);

  await interaction.editReply({ content: lines.join('\n') });
}

async function handleWallets(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const wallets = getWallets(interaction.user.id);

  if (wallets.length === 0) {
    await interaction.editReply({
      content: 'ℹ️ You have no linked wallets. Use `/verify <wallet>` to add one.',
    });
    return;
  }

  const lines = [
    `📂 **Your linked wallets (${wallets.length}):**`,
    '',
    ...wallets.map((w, i) => `**${i + 1}.** \`${w}\``),
    '',
    'Use `/verify <wallet>` to add another wallet.',
  ];

  await interaction.editReply({ content: lines.join('\n') });
}

async function handleUnlink(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const wallet = interaction.options.getString('wallet', true).trim();

  if (!WALLET_REGEX.test(wallet)) {
    await interaction.editReply({ content: '❌ Invalid format. Example: `0.0.123456`' });
    return;
  }

  const removed = removeWallet(interaction.user.id, wallet);

  if (!removed) {
    const wallets = getWallets(interaction.user.id);
    if (wallets.length === 0) {
      await interaction.editReply({
        content: `❌ \`${wallet}\` is not linked to your account. You have no linked wallets.`,
      });
    } else {
      await interaction.editReply({
        content: [
          `❌ \`${wallet}\` is not linked to your account.`,
          '',
          `📂 **Your linked wallets:** ${wallets.map(w => `\`${w}\``).join(', ')}`,
        ].join('\n'),
      });
    }
    return;
  }

  const remainingWallets = getWallets(interaction.user.id);
  const member = interaction.member as GuildMember;

  if (remainingWallets.length === 0) {
    const qual = await evaluateRolesForWallets([]);
    const { revoked, errors } = await assignRoles(member, qual);

    const lines = [
      `✅ Wallet \`${wallet}\` has been unlinked.`,
      '',
      'ℹ️ No wallets remaining — all managed roles removed.',
    ];
    if (revoked.length > 0) lines.push(`🗑️ **Roles removed:** ${revoked.join(', ')}`);
    if (errors.length > 0) lines.push(`⚠️ Could not remove: ${errors.join(', ')}`);
    await interaction.editReply({ content: lines.join('\n') });
    return;
  }

  const qual = await evaluateRolesForWallets(remainingWallets);
  const { granted, revoked, errors } = await assignRoles(member, qual);

  const lines = [
    `✅ Wallet \`${wallet}\` has been unlinked.`,
    '',
    `📂 **Remaining wallets (${remainingWallets.length}):** ${remainingWallets.map(w => `\`${w}\``).join(', ')}`,
    '',
  ];

  if (granted.length > 0) lines.push(`🎉 **Roles gained:** ${granted.join(', ')}`);
  if (revoked.length > 0) lines.push(`🗑️ **Roles removed:** ${revoked.join(', ')}`);
  if (granted.length === 0 && revoked.length === 0) lines.push('ℹ️ Your roles remain unchanged.');
  if (errors.length > 0) lines.push(`⚠️ Could not update: ${errors.join(', ')}`);

  await interaction.editReply({ content: lines.join('\n') });
}

async function handleRule(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const sub = interaction.options.getSubcommand(true);

  if (sub === 'list') {
    const rules = getRules();
    if (rules.length === 0) {
      await interaction.editReply({ content: 'ℹ️ No custom rules configured yet. Use `/rule add` to create one.' });
      return;
    }
    const lines = ['📋 **Custom role assignment rules:**', ''];
    for (const rule of rules) {
      const threshold = rule.type === 'nft'
        ? `≥ ${rule.minAmount} NFT(s)`
        : `≥ ${rule.minAmount.toLocaleString()} (${rule.decimals} decimals)`;
      lines.push(
        `**[${rule.id}]** ${rule.type === 'nft' ? '🖼️' : '🪙'} \`${rule.tokenId}\` — ${threshold}`,
        `　→ Role: **${rule.roleName}** · Label: *${rule.label}*`,
        '',
      );
    }
    await interaction.editReply({ content: lines.join('\n') });
    return;
  }

  if (sub === 'remove') {
    const id = interaction.options.getString('id', true).trim().toUpperCase();
    const removed = removeRule(id);
    if (!removed) {
      await interaction.editReply({ content: `❌ No rule found with ID \`${id}\`. Use \`/rule list\` to see all rule IDs.` });
      return;
    }
    await interaction.editReply({
      content: [
        `✅ Rule \`${removed.id}\` deleted.`,
        `　Removed: *${removed.label}* → **${removed.roleName}**`,
        '',
        'ℹ️ This role will be removed from members on their next sync (up to 30 min) or when they re-verify.',
      ].join('\n'),
    });
    return;
  }

  if (sub === 'add') {
    const type = interaction.options.getString('type', true) as 'token' | 'nft';
    const tokenId = interaction.options.getString('token_id', true).trim();
    const role = interaction.options.getRole('role', true);
    const minAmount = interaction.options.getNumber('min_amount') ?? 1;
    const decimals = type === 'nft' ? 0 : (interaction.options.getInteger('decimals') ?? 0);
    const label = interaction.options.getString('label') ?? `${type === 'nft' ? 'NFT' : 'Token'} ${tokenId}`;

    if (!WALLET_REGEX.test(tokenId)) {
      await interaction.editReply({ content: '❌ Invalid token ID format. Example: `0.0.123456`' });
      return;
    }

    if (minAmount <= 0) {
      await interaction.editReply({ content: '❌ `min_amount` must be greater than 0.' });
      return;
    }

    const newRule = addRule({
      type,
      tokenId,
      minAmount,
      decimals,
      roleId: role.id,
      roleName: role.name,
      label,
      createdBy: interaction.user.id,
    });

    const threshold = type === 'nft'
      ? `≥ ${minAmount} NFT(s)`
      : `≥ ${minAmount.toLocaleString()} (${decimals} decimals)`;

    await interaction.editReply({
      content: [
        `✅ Rule **\`${newRule.id}\`** created!`,
        '',
        `${type === 'nft' ? '🖼️' : '🪙'} **Type:** ${type === 'nft' ? 'NFT' : 'Fungible Token'}`,
        `🔑 **Token ID:** \`${tokenId}\``,
        `📊 **Threshold:** ${threshold}`,
        `🎖️ **Role awarded:** **${role.name}**`,
        `🏷️ **Label:** *${label}*`,
        `🆔 **Rule ID:** \`${newRule.id}\``,
        '',
        'ℹ️ The role will be automatically assigned on next verify/sync for qualifying holders.',
      ].join('\n'),
    });
    return;
  }
}

const SYNC_INTERVAL_MS = 30 * 60 * 1000;

client.once('ready', async () => {
  console.log(`✅ WRAPpDEX Verifier Bot connected as ${client.user?.tag}`);
  await registerCommands();

  setInterval(() => {
    syncAllRoles().catch(err => console.error('Sync error:', err));
  }, SYNC_INTERVAL_MS);

  console.log(`🔄 Auto role sync scheduled every 30 minutes`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const handlers: Record<string, (i: ChatInputCommandInteraction) => Promise<void>> = {
    verify: handleVerify,
    confirm: handleConfirm,
    wallets: handleWallets,
    unlink: handleUnlink,
    rule: handleRule,
  };

  const handler = handlers[interaction.commandName];
  if (!handler) return;

  try {
    await handler(interaction);
  } catch (err) {
    console.error(`Error handling /${interaction.commandName}:`, err);
    const msg = '❌ An unexpected error occurred. Please try again.';
    if (interaction.deferred) {
      await interaction.editReply({ content: msg }).catch(() => undefined);
    } else {
      await interaction.reply({ content: msg, ephemeral: true }).catch(() => undefined);
    }
  }
});

client.login(config.DISCORD_BOT_TOKEN);
