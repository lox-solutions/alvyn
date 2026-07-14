import { gql } from "@apollo/client";

export const CREATE_ACCOUNT = gql`
  mutation CreateBankAccount($accountId: String!, $ownerName: String!) {
    createBankAccount(accountId: $accountId, ownerName: $ownerName) {
      accountId
      status
      ownerName
    }
  }
`;

export const DEPOSIT = gql`
  mutation Deposit($accountId: String!, $amount: Float!) {
    deposit(accountId: $accountId, amount: $amount) {
      type
      bankAccountId
      amount
    }
  }
`;

export const WITHDRAW = gql`
  mutation Withdraw($accountId: String!, $amount: Float!) {
    withdraw(accountId: $accountId, amount: $amount) {
      type
      bankAccountId
      amount
    }
  }
`;
