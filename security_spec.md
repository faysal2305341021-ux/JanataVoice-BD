# Security Specification — JanataVoice BD Firestore Rules

## 1. Data Invariants
1. **Default-Deny Catch-All**: Every path not explicitly matched is denied (`allow read, write: if false`).
2. **Identity Integrity**: A user document in `/users/{userId}` can only be read by its owner or verified admin/staff (`role` in `['admin', 'high_authority', 'dept_head', 'dept_officer', 'triage_officer']`). Citizens cannot self-elevate their `role` on create or update.
3. **Append-Only Audit Chain**: Documents in `/complaint_events/{eventId}` are strictly immutable (`allow update, delete: if false`).
4. **No Orphaned Complaints**: Creating a complaint requires `citizenId == request.auth.uid`, valid status `SUBMITTED` or `TRIAGING`, and bounded text lengths.
5. **PII Isolation**: User email, phone, and `nidMock` are never readable via blanket `isSignedIn()` list queries.
6. **Field Report Requirement & Terminal Lock**: Closed complaints cannot be mutated by non-admin clients.

## 2. "Dirty Dozen" Adversarial Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated Read on `/users/u1`**: Anonymous client attempts `get(/users/u1)` -> DENIED.
2. **Privilege Escalation on Signup**: Client creates `/users/{uid}` with `role: "admin"` -> DENIED.
3. **Role Self-Elevation on Update**: Citizen updates `/users/{uid}` changing `role` from `"citizen"` to `"high_authority"` -> DENIED.
4. **Cross-User PII Read**: Citizen A queries `/users` list or reads `/users/{citizenB}` -> DENIED.
5. **Shadow Field Injection on Complaint**: Client creates `/complaints/{id}` with extra ghost field `isVerifiedByCabinet: true` -> DENIED (`hasOnly` check).
6. **Identity Spoofing on Complaint**: Citizen A creates `/complaints/{id}` with `citizenId: "citizenB"` -> DENIED.
7. **State Shortcutting on Complaint Creation**: Citizen creates `/complaints/{id}` directly with `status: "RESOLVED"` -> DENIED.
8. **Audit Log Tampering (Update)**: Any user (even admin) attempts `update` on `/complaint_events/{eventId}` -> DENIED (`allow update: if false`).
9. **Audit Log Deletion**: Any user attempts `delete` on `/complaint_events/{eventId}` -> DENIED (`allow delete: if false`).
10. **ID Poisoning (1.5KB Document ID)**: Client attempts `create` at `/complaints/{1500_char_id}` -> DENIED (`isValidId`).
11. **Oversized Raw Text Payload**: Client submits complaint with 50,000-character `rawText` -> DENIED (`size() <= 5000`).
12. **Unverified Email Spoof**: Unverified account (`email_verified: false`) matching admin email attempts admin write on `/sla_configs/CRITICAL` -> DENIED.
