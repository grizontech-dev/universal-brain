ALTER TABLE wallet_transactions DROP CONSTRAINT wallet_transactions_type_check;

ALTER TABLE wallet_transactions ADD CONSTRAINT wallet_transactions_type_check
  CHECK (type IN ('grant','deduct','topup','rollover','refund','adjustment','hold','settled','released'));
