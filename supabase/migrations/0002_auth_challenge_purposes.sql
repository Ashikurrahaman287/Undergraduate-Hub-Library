-- Password-based phone authentication uses OTPs as short-lived verification
-- challenges for signup, password reset, and the first administrator setup.
alter table public.otp_challenges
  add column if not exists purpose text not null default 'member_signup',
  add column if not exists verification_token_hash text,
  add column if not exists verification_expires_at timestamptz,
  add column if not exists verification_consumed_at timestamptz;