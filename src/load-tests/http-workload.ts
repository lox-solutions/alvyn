import type { HttpLoadTestConfig, HttpOperationPlan } from "./http-types";

const PERCENT_SCALE = 100;
const HOT_ACCOUNT_PERCENT = 75;
const VALUE_SEED_MULTIPLIER = 31;
const VALUE_OPERATION_MULTIPLIER = 17;

export function getAccountId(accountIndex: number): string {
  return `account-${accountIndex}`;
}

function operationValue(seed: number, operationIndex: number): number {
  return Math.abs(
    seed * VALUE_SEED_MULTIPLIER + operationIndex * VALUE_OPERATION_MULTIPLIER,
  );
}

export function getExpectedHttpOperation({
  config,
  operationIndex,
}: {
  config: HttpLoadTestConfig;
  operationIndex: number;
}): HttpOperationPlan {
  const value = operationValue(config.seed, operationIndex);
  const allAccountsAreHot = config.hotAccountCount === config.accountCount;
  const hot =
    allAccountsAreHot ||
    (config.hotAccountCount > 0 && value % PERCENT_SCALE < HOT_ACCOUNT_PERCENT);
  const accountPoolSize = hot
    ? config.hotAccountCount
    : config.accountCount - config.hotAccountCount;
  const accountOffset = hot ? 0 : config.hotAccountCount;
  const accountIndex = accountOffset + (value % accountPoolSize);
  const kind = value % PERCENT_SCALE < config.readPercent ? "read" : "deposit";
  return {
    kind,
    accountId: getAccountId(accountIndex),
    amount: 1 + (value % 10),
    operationToken: `http:${config.seed}:${operationIndex}`,
  };
}

export function getAccountIds(config: HttpLoadTestConfig): string[] {
  return Array.from({ length: config.accountCount }, (_, index) =>
    getAccountId(index),
  );
}
