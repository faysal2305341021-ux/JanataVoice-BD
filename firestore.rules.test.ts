/**
 * Security rules verification matrix matching security_spec.md "Dirty Dozen" payloads.
 * Intended to run against @firebase/rules-unit-testing when local Firestore emulator is started.
 */
export const DIRTY_DOZEN_CASES = [
  { name: 'Unauthenticated read on /users/u1', path: 'users/u1', op: 'get', expected: 'PERMISSION_DENIED' },
  { name: 'Privilege escalation on signup (role=admin)', path: 'users/c1', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Role self-elevation on update', path: 'users/c1', op: 'update', expected: 'PERMISSION_DENIED' },
  { name: 'Cross-user PII list/read', path: 'users', op: 'list', expected: 'PERMISSION_DENIED' },
  { name: 'Shadow field injection on complaint', path: 'complaints/cmp1', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Identity spoofing on complaint', path: 'complaints/cmp1', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'State shortcutting on complaint create', path: 'complaints/cmp1', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Audit log tampering (update)', path: 'complaint_events/ev1', op: 'update', expected: 'PERMISSION_DENIED' },
  { name: 'Audit log deletion', path: 'complaint_events/ev1', op: 'delete', expected: 'PERMISSION_DENIED' },
  { name: 'ID poisoning (>128 chars)', path: 'complaints/' + 'x'.repeat(1500), op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Oversized rawText (>5000 chars)', path: 'complaints/cmp1', op: 'create', expected: 'PERMISSION_DENIED' },
  { name: 'Unverified email spoof on SLA config', path: 'sla_configs/CRITICAL', op: 'update', expected: 'PERMISSION_DENIED' },
];
