import { useState } from "react";
import { useSubscription, useQuery } from "@apollo/client/react";
import { BALANCE_CHANGED } from "../graphql/subscriptions";
import { GET_BALANCE } from "../graphql/queries";
import { sectionStyle, resultStyle } from "../styles/shared";

interface Props {
  accountId: string;
}

interface Balance {
  accountId: string;
  balance: number;
}

interface BalanceChangedData {
  balanceChanged: Balance | null;
}

interface GetBalanceData {
  bankAccountBalance: Balance | null;
}

interface BalanceVariables {
  accountId: string;
}

interface GetBalanceVariables {
  id: string;
}

export function LiveBalance({ accountId }: Props) {
  const [subscriptionBalance, setSubscriptionBalance] = useState<number | null>(
    null,
  );

  useSubscription<BalanceChangedData, BalanceVariables>(BALANCE_CHANGED, {
    variables: { accountId },
    onData: ({ data }) => {
      const balance = data.data?.balanceChanged?.balance;
      if (balance !== undefined) {
        setSubscriptionBalance(balance);
      }
    },
    skip: !accountId,
  });

  const { data: queryData } = useQuery<GetBalanceData, GetBalanceVariables>(
    GET_BALANCE,
    {
      variables: { id: accountId },
      skip: !accountId,
    },
  );

  const balance = subscriptionBalance ?? queryData?.bankAccountBalance?.balance;

  if (!accountId) {
    return null;
  }

  return (
    <section style={sectionStyle}>
      <h2>Live Balance</h2>
      <pre style={resultStyle}>
        {balance !== undefined ? `$${balance}` : "Loading..."}
      </pre>
    </section>
  );
}
