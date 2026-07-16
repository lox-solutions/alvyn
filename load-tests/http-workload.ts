import type { HttpLoadTestConfig, HttpOperationPlan } from "./http-types";

const PERCENT_SCALE = 100;
const VALUE_SEED_MULTIPLIER = 31;
const VALUE_OPERATION_MULTIPLIER = 17;
const MAX_AMOUNT_VARIATION = 10;

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
  const userOperationIndex = Math.floor(
    operationIndex / config.activeUserCount,
  );
  const userIndex =
    ((operationIndex % config.activeUserCount) + config.seed) %
    config.activeUserCount;
  const allAccountsAreHot = config.hotAccountCount === config.accountCount;
  const hot =
    allAccountsAreHot ||
    (config.hotAccountCount > 0 &&
      value % PERCENT_SCALE < config.hotTrafficPercent);
  const accountPoolSize = hot
    ? config.hotAccountCount
    : config.accountCount - config.hotAccountCount;
  const accountOffset = hot ? 0 : config.hotAccountCount;
  const accountIndex =
    config.profile === "daily"
      ? userIndex
      : accountOffset + (value % accountPoolSize);
  const readOperationsPerUser = Math.round(
    (config.operationsPerUser * config.readPercent) / PERCENT_SCALE,
  );
  const userActivitySlot =
    (userOperationIndex + userIndex) % config.operationsPerUser;
  const kind = userActivitySlot < readOperationsPerUser ? "read" : "deposit";
  return {
    kind,
    userId: `user-${userIndex}`,
    userOperationIndex,
    accountId: getAccountId(accountIndex),
    amount: 1 + (value % MAX_AMOUNT_VARIATION),
    operationToken: `http:${config.seed}:${operationIndex}`,
  };
}

export function getAccountIds(config: HttpLoadTestConfig): string[] {
  return Array.from({ length: config.accountCount }, (_, index) =>
    getAccountId(index),
  );
}
