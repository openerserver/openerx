/**
 * Password policy — shared rules (pure logic, no framework deps).
 * Keep in sync with control-plane/service/src/modules/shared/password-policy.ts.
 */

export interface PasswordPolicyResult {
  valid: boolean;
  errors: string[];
}

const MIN_LENGTH = 8;
const RULES: Array<{ test: RegExp; message: string }> = [
  { test: /[a-z]/, message: "需包含至少一个小写字母" },
  { test: /[A-Z]/, message: "需包含至少一个大写字母" },
  { test: /\d/, message: "需包含至少一个数字" },
  { test: /[^a-zA-Z0-9]/, message: "需包含至少一个特殊字符" },
];

export function validatePasswordPolicy(password: string): PasswordPolicyResult {
  const errors: string[] = [];

  if (password.length < MIN_LENGTH) {
    errors.push(`密码长度至少 ${MIN_LENGTH} 位`);
  }

  for (const rule of RULES) {
    if (!rule.test.test(password)) {
      errors.push(rule.message);
    }
  }

  return { valid: errors.length === 0, errors };
}

export const PASSWORD_POLICY_HINT = "至少 8 位，需包含大小写字母、数字和特殊字符";
