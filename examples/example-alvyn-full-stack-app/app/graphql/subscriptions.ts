import { gql } from "@apollo/client";

export const TRANSACTION_ADDED = gql`
  subscription TransactionAdded($accountId: String!) {
    transactionAdded(accountId: $accountId) {
      type
      bankAccountId
      amount
    }
  }
`;

export const BALANCE_CHANGED = gql`
  subscription BalanceChanged($accountId: String!) {
    balanceChanged(accountId: $accountId) {
      accountId
      balance
    }
  }
`;