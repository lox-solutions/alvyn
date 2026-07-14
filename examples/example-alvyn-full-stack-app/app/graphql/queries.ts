import { gql } from "@apollo/client";

export const GET_BANK_ACCOUNT = gql`
  query GetBankAccount($id: String!) {
    bankAccount(id: $id) {
      accountId
      status
      ownerName
    }
  }
`;

export const GET_BALANCE = gql`
  query GetBalance($id: String!) {
    bankAccountBalance(id: $id) {
      accountId
      balance
    }
  }
`;

export const GET_TRANSACTIONS = gql`
  query GetTransactions($accountId: String!) {
    transactions(accountId: $accountId) {
      type
      bankAccountId
      amount
      version
    }
  }
`;
