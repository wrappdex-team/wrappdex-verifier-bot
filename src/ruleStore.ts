import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const RULES_FILE = path.join(DATA_DIR, 'rules.json');

export type RuleType = 'token' | 'nft';

export interface Rule {
  id: string;
  label: string;
  type: RuleType;
  tokenId: string;
  minAmount: number;
  decimals: number;
  roleId: string;
  roleName: string;
  createdBy: string;
  createdAt: string;
}

function loadRules(): Rule[] {
  if (!fs.existsSync(RULES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')) as Rule[];
  } catch {
    return [];
  }
}

function saveRules(rules: Rule[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(RULES_FILE, JSON.stringify(rules, null, 2));
}

export function getRules(): Rule[] {
  return loadRules();
}

export function addRule(rule: Omit<Rule, 'id' | 'createdAt'>): Rule {
  const rules = loadRules();
  const newRule: Rule = {
    ...rule,
    id: Math.random().toString(36).slice(2, 9).toUpperCase(),
    createdAt: new Date().toISOString(),
  };
  rules.push(newRule);
  saveRules(rules);
  return newRule;
}

export function removeRule(id: string): Rule | null {
  const rules = loadRules();
  const idx = rules.findIndex(r => r.id === id);
  if (idx === -1) return null;
  const [removed] = rules.splice(idx, 1);
  saveRules(rules);
  return removed ?? null;
}
